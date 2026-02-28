import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

// We need to reset the module-level cache between tests.
// Use vi.resetModules() + dynamic import to get a fresh module each time.

// ---------------------------------------------------------------------------
// Mock gzip data builder
// ---------------------------------------------------------------------------

function buildCrossRefTsv(entries: Array<[string, string]>): string {
  const lines = [
    "# Cross-references from OpenBible.info",
    "# From Verse\tTo Verse",
    ...entries.map(([from, to]) => `${from}\t${to}`),
  ];
  return lines.join("\n");
}

function compressToGzip(data: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { createGzip } = require("node:zlib") as typeof import("node:zlib");
    const chunks: Buffer[] = [];
    const gzip = createGzip();
    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
    gzip.end(data);
  });
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createCrossRefTools", () => {
  it("returns one tool named bible_cross_references", async () => {
    const { createCrossRefTools } = await import("./cross-ref-tools.js");
    const tools = createCrossRefTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("bible_cross_references");
  });

  it("tool has required fields", async () => {
    const { createCrossRefTools } = await import("./cross-ref-tools.js");
    const tools = createCrossRefTools();
    const tool = tools[0];
    expect(tool.description).toBeTruthy();
    expect(tool.defaultPolicy).toBe("allow");
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// bible_cross_references
// ---------------------------------------------------------------------------

describe("bible_cross_references", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function mockFetchWithGzipData(entries: Array<[string, string]>) {
    const tsv = buildCrossRefTsv(entries);
    const gzipped = await compressToGzip(tsv);

    // Create a ReadableStream from the buffer (web API style)
    const webStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(gzipped));
        controller.close();
      },
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: webStream,
    });
  }

  async function getCrossRefTool() {
    const { createCrossRefTools } = await import("./cross-ref-tools.js");
    return createCrossRefTools()[0];
  }

  it("fetches cross-reference data and returns results for a known verse", async () => {
    await mockFetchWithGzipData([
      ["John.3.16", "Gen.22.2"],
      ["John.3.16", "Rom.5.8"],
      ["John.3.16", "1John.4.9"],
      ["Gen.1.1", "John.1.1"],
    ]);

    const tool = await getCrossRefTool();
    const result = await tool.execute({ reference: "John 3:16" });

    expect(result).toContain("Cross-references for John 3:16");
    expect(result).toContain("Genesis 22:2");
    expect(result).toContain("Romans 5:8");
    expect(result).toContain("1 John 4:9");
  });

  it("returns human-readable references from OSIS format", async () => {
    await mockFetchWithGzipData([
      ["Ps.23.1", "Ps.80.1"],
      ["Ps.23.1", "Isa.40.11"],
    ]);

    const tool = await getCrossRefTool();
    const result = await tool.execute({ reference: "Psalms 23:1" });

    expect(result).toContain("Psalms 80:1");
    expect(result).toContain("Isaiah 40:11");
  });

  it("returns friendly message when no cross-references found", async () => {
    await mockFetchWithGzipData([
      ["Gen.1.1", "John.1.1"],
    ]);

    const tool = await getCrossRefTool();
    const result = await tool.execute({ reference: "Obadiah 1:21" });

    expect(result).toContain('No cross-references found for "Obadiah 1:21"');
  });

  it("respects max_results parameter", async () => {
    await mockFetchWithGzipData([
      ["John.3.16", "Gen.22.2"],
      ["John.3.16", "Rom.5.8"],
      ["John.3.16", "1John.4.9"],
      ["John.3.16", "Rom.8.32"],
    ]);

    const tool = await getCrossRefTool();
    const result = await tool.execute({ reference: "John 3:16", max_results: 2 });

    expect(result).toContain("2 of 4");
    expect(result).toContain("1. Genesis 22:2");
    expect(result).toContain("2. Romans 5:8");
    expect(result).not.toContain("3.");
    expect(result).toContain("... and 2 more");
  });

  it("caps max_results at 50", async () => {
    const entries: Array<[string, string]> = Array.from(
      { length: 60 },
      (_, i) => ["Gen.1.1", `Gen.1.${i + 2}`],
    );
    await mockFetchWithGzipData(entries);

    const tool = await getCrossRefTool();
    const result = await tool.execute({ reference: "Genesis 1:1", max_results: 100 });

    expect(result).toContain("50.");
    expect(result).not.toContain("51.");
  });

  it("throws on missing reference parameter", async () => {
    const tool = await getCrossRefTool();
    await expect(tool.execute({})).rejects.toThrow(
      "'reference' parameter is required",
    );
  });

  it("throws when download fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const tool = await getCrossRefTool();
    await expect(
      tool.execute({ reference: "John 3:16" }),
    ).rejects.toThrow("Failed to download cross-references: HTTP 500");
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = await getCrossRefTool();
    await expect(
      tool.execute({ reference: "John 3:16" }),
    ).rejects.toThrow("Network error");
  });

  it("shows numbered list of cross-references", async () => {
    await mockFetchWithGzipData([
      ["Gen.1.1", "John.1.1"],
      ["Gen.1.1", "Heb.11.3"],
    ]);

    const tool = await getCrossRefTool();
    const result = await tool.execute({ reference: "Genesis 1:1" });

    expect(result).toContain("1. John 1:1");
    expect(result).toContain("2. Hebrews 11:3");
  });
});
