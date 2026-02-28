import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBibleHubTools } from "./biblehub-tools.js";

// ---------------------------------------------------------------------------
// Mock HTML data
// ---------------------------------------------------------------------------

const commentaryHtml = `
<html>
<head><title>John 3:16 Commentaries</title></head>
<body>
<div class="cmt">
<h3>Matthew Henry's Commentary</h3>
<p>Here is the <b>sum</b> of the whole gospel. God so loved the world, that he gave his only-begotten Son.</p>
<h3>Gill's Exposition</h3>
<p>For God so loved the world; the Persic version reads, &quot;so loved mankind&quot;.</p>
</div>
<div id="footer">Footer content</div>
</body>
</html>`;

const interlinearHtml = `
<html>
<head><title>Genesis 1:1 Interlinear</title></head>
<body>
<div class="padleft">
<table>
<tr>
  <td class="str">H7225</td>
  <td class="heb">&#1512;&#1461;&#1488;&#1513;&#1473;&#1460;&#1497;&#1514;</td>
  <td class="trans">re'shith</td>
  <td class="eng">In the beginning</td>
</tr>
<tr>
  <td class="str">H430</td>
  <td class="heb">&#1488;&#1457;&#1500;&#1465;&#1492;&#1460;&#1497;&#1501;</td>
  <td class="trans">'E-lo-him</td>
  <td class="eng">God</td>
</tr>
</table>
</div>
<div class="footer">Footer</div>
</body>
</html>`;

const noCommentaryHtml = `
<html>
<body>
<div class="main">No matching content here.</div>
<div id="footer">Footer</div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createBibleHubTools", () => {
  it("returns two tools", () => {
    const tools = createBibleHubTools();
    expect(tools).toHaveLength(2);
  });

  it("has biblehub_commentary and biblehub_interlinear", () => {
    const tools = createBibleHubTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("biblehub_commentary");
    expect(names).toContain("biblehub_interlinear");
  });

  it("all tools have defaultPolicy allow", () => {
    const tools = createBibleHubTools();
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe("allow");
    }
  });

  it("all tools have parameters and execute", () => {
    const tools = createBibleHubTools();
    for (const tool of tools) {
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// biblehub_commentary
// ---------------------------------------------------------------------------

describe("biblehub_commentary", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchHtml(html: string) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    });
  }

  function getCommentaryTool() {
    return createBibleHubTools().find(
      (t) => t.name === "biblehub_commentary",
    )!;
  }

  it("constructs correct URL with normalized book name", async () => {
    mockFetchHtml(commentaryHtml);
    const tool = getCommentaryTool();
    await tool.execute({ book: "John", chapter: 3, verse: 16 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("biblehub.com/commentaries/john/3-16.htm");
  });

  it("normalizes book names with spaces", async () => {
    mockFetchHtml(noCommentaryHtml);
    const tool = getCommentaryTool();
    await tool.execute({ book: "1 Corinthians", chapter: 13, verse: 4 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("/commentaries/1_corinthians/13-4.htm");
  });

  it("normalizes Psalm to psalms", async () => {
    mockFetchHtml(noCommentaryHtml);
    const tool = getCommentaryTool();
    await tool.execute({ book: "Psalm", chapter: 23, verse: 1 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("/commentaries/psalms/23-1.htm");
  });

  it("sends User-Agent header", async () => {
    mockFetchHtml(commentaryHtml);
    const tool = getCommentaryTool();
    await tool.execute({ book: "John", chapter: 3, verse: 16 });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect((options.headers as Record<string, string>)["User-Agent"]).toBe(
      "Haya/0.1",
    );
  });

  it("extracts and strips HTML from commentary", async () => {
    mockFetchHtml(commentaryHtml);
    const tool = getCommentaryTool();
    const result = await tool.execute({ book: "John", chapter: 3, verse: 16 });

    expect(result).toContain("Commentary: John 3:16 (BibleHub)");
    expect(result).toContain("Matthew Henry's Commentary");
    expect(result).toContain("sum");
    expect(result).toContain("God so loved the world");
    expect(result).toContain("Gill's Exposition");
    // HTML tags should be stripped
    expect(result).not.toContain("<h3>");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<b>");
    // HTML entities should be decoded
    expect(result).not.toContain("&quot;");
  });

  it("includes source URL", async () => {
    mockFetchHtml(commentaryHtml);
    const tool = getCommentaryTool();
    const result = await tool.execute({ book: "John", chapter: 3, verse: 16 });

    expect(result).toContain("Source: https://biblehub.com/commentaries/john/3-16.htm");
  });

  it("returns friendly message when no commentary found", async () => {
    mockFetchHtml(noCommentaryHtml);
    const tool = getCommentaryTool();
    const result = await tool.execute({ book: "John", chapter: 99, verse: 99 });

    expect(result).toContain("No commentary found for John 99:99");
  });

  it("throws on missing book parameter", async () => {
    const tool = getCommentaryTool();
    await expect(
      tool.execute({ chapter: 3, verse: 16 }),
    ).rejects.toThrow("'book' parameter is required");
  });

  it("throws on missing chapter parameter", async () => {
    const tool = getCommentaryTool();
    await expect(
      tool.execute({ book: "John", verse: 16 }),
    ).rejects.toThrow("'chapter' parameter is required");
  });

  it("throws on missing verse parameter", async () => {
    const tool = getCommentaryTool();
    await expect(
      tool.execute({ book: "John", chapter: 3 }),
    ).rejects.toThrow("'verse' parameter is required");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const tool = getCommentaryTool();
    await expect(
      tool.execute({ book: "John", chapter: 3, verse: 16 }),
    ).rejects.toThrow("BibleHub HTTP 404");
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getCommentaryTool();
    await expect(
      tool.execute({ book: "John", chapter: 3, verse: 16 }),
    ).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// biblehub_interlinear
// ---------------------------------------------------------------------------

describe("biblehub_interlinear", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchHtml(html: string) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    });
  }

  function getInterlinearTool() {
    return createBibleHubTools().find(
      (t) => t.name === "biblehub_interlinear",
    )!;
  }

  it("constructs correct URL", async () => {
    mockFetchHtml(interlinearHtml);
    const tool = getInterlinearTool();
    await tool.execute({ book: "Genesis", chapter: 1, verse: 1 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("biblehub.com/interlinear/genesis/1-1.htm");
  });

  it("normalizes book names with spaces for URL", async () => {
    mockFetchHtml(noCommentaryHtml);
    const tool = getInterlinearTool();
    await tool.execute({ book: "Song of Solomon", chapter: 1, verse: 1 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("/interlinear/songs/1-1.htm");
  });

  it("extracts and strips HTML from interlinear data", async () => {
    mockFetchHtml(interlinearHtml);
    const tool = getInterlinearTool();
    const result = await tool.execute({ book: "Genesis", chapter: 1, verse: 1 });

    expect(result).toContain("Interlinear: Genesis 1:1 (BibleHub)");
    expect(result).toContain("H7225");
    expect(result).toContain("In the beginning");
    expect(result).toContain("H430");
    expect(result).toContain("God");
    // HTML tags should be stripped
    expect(result).not.toContain("<table>");
    expect(result).not.toContain("<td");
  });

  it("includes source URL", async () => {
    mockFetchHtml(interlinearHtml);
    const tool = getInterlinearTool();
    const result = await tool.execute({ book: "Genesis", chapter: 1, verse: 1 });

    expect(result).toContain(
      "Source: https://biblehub.com/interlinear/genesis/1-1.htm",
    );
  });

  it("returns friendly message when no interlinear data found", async () => {
    mockFetchHtml(noCommentaryHtml);
    const tool = getInterlinearTool();
    const result = await tool.execute({ book: "Genesis", chapter: 99, verse: 99 });

    expect(result).toContain("No interlinear data found for Genesis 99:99");
  });

  it("throws on missing book parameter", async () => {
    const tool = getInterlinearTool();
    await expect(
      tool.execute({ chapter: 1, verse: 1 }),
    ).rejects.toThrow("'book' parameter is required");
  });

  it("throws on missing chapter parameter", async () => {
    const tool = getInterlinearTool();
    await expect(
      tool.execute({ book: "Genesis", verse: 1 }),
    ).rejects.toThrow("'chapter' parameter is required");
  });

  it("throws on missing verse parameter", async () => {
    const tool = getInterlinearTool();
    await expect(
      tool.execute({ book: "Genesis", chapter: 1 }),
    ).rejects.toThrow("'verse' parameter is required");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tool = getInterlinearTool();
    await expect(
      tool.execute({ book: "Genesis", chapter: 1, verse: 1 }),
    ).rejects.toThrow("BibleHub HTTP 500");
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getInterlinearTool();
    await expect(
      tool.execute({ book: "Genesis", chapter: 1, verse: 1 }),
    ).rejects.toThrow("Network error");
  });

  it("sends User-Agent header", async () => {
    mockFetchHtml(interlinearHtml);
    const tool = getInterlinearTool();
    await tool.execute({ book: "Genesis", chapter: 1, verse: 1 });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect((options.headers as Record<string, string>)["User-Agent"]).toBe(
      "Haya/0.1",
    );
  });
});
