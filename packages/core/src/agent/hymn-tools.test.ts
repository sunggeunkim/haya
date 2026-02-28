import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHymnTools } from "./hymn-tools.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const hymnResponse = [
  {
    title: "The Lord Is My Shepherd",
    date: "1868",
    meter: "8.7.8.7",
    "place of origin": "England",
    "original language": "English",
    "text link": "/text/the_lord_is_my_shepherd",
    "number of hymnals": 342,
    "scripture references": "Psalm 23",
  },
  {
    title: "My Shepherd Will Supply My Need",
    date: "1719",
    meter: "C.M.D.",
    "original language": "English",
    "number of hymnals": 250,
    "scripture references": "Psalm 23",
    "text link": "/text/my_shepherd_will_supply",
  },
  {
    title: "He Leadeth Me",
    date: "1862",
    "number of hymnals": 150,
    "scripture references": "Psalm 23; Psalm 31:3",
  },
];

const singleHymnResponse = [
  {
    title: "Amazing Grace",
    date: "1779",
    meter: "C.M.",
    "original language": "English",
    "number of hymnals": 1400,
    "scripture references": "1 Chronicles 17:16-17; Ephesians 2:8",
    "text link": "/text/amazing_grace",
  },
];

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createHymnTools", () => {
  it("returns one tool", () => {
    const tools = createHymnTools();
    expect(tools).toHaveLength(1);
  });

  it("has hymn_by_scripture", () => {
    const tools = createHymnTools();
    expect(tools[0].name).toBe("hymn_by_scripture");
  });

  it("tool has defaultPolicy allow", () => {
    const tools = createHymnTools();
    expect(tools[0].defaultPolicy).toBe("allow");
  });

  it("tool has parameters and execute", () => {
    const tools = createHymnTools();
    expect(tools[0].parameters).toBeTruthy();
    expect(typeof tools[0].execute).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// hymn_by_scripture
// ---------------------------------------------------------------------------

describe("hymn_by_scripture", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
  }

  function getHymnTool() {
    return createHymnTools()[0];
  }

  it("constructs correct URL with reference parameter", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    await tool.execute({ reference: "Psalm 23" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("hymnary.org/api/scripture");
    expect(url).toContain("reference=Psalm+23");
  });

  it("constructs correct URL with book and chapter parameters", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    await tool.execute({ book: "1 John", fromChapter: 3, fromVerse: 1, toChapter: 3, toVerse: 24 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("book=1+John");
    expect(url).toContain("fromChapter=3");
    expect(url).toContain("fromVerse=1");
    expect(url).toContain("toChapter=3");
    expect(url).toContain("toVerse=24");
    expect(url).not.toContain("reference=");
  });

  it("includes all=true when include_all is set", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    await tool.execute({ reference: "Psalm 23", include_all: true });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("all=true");
  });

  it("sends Accept: application/json header", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    await tool.execute({ reference: "Psalm 23" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.headers).toEqual({ Accept: "application/json" });
  });

  it("formats hymn list correctly", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Psalm 23" });

    expect(result).toContain('Hymns for Psalm 23 (3 of 3):');
    expect(result).toContain("1. The Lord Is My Shepherd");
    expect(result).toContain("   Date: 1868");
    expect(result).toContain("   Meter: 8.7.8.7");
    expect(result).toContain("   Language: English");
    expect(result).toContain("   Hymnals: 342");
    expect(result).toContain("   Scripture: Psalm 23");
    expect(result).toContain("   Link: https://hymnary.org/text/the_lord_is_my_shepherd");
  });

  it("shows second hymn details", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Psalm 23" });

    expect(result).toContain("2. My Shepherd Will Supply My Need");
    expect(result).toContain("   Date: 1719");
    expect(result).toContain("   Meter: C.M.D.");
  });

  it("omits optional fields when not present", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Psalm 23" });

    // Third hymn ("He Leadeth Me") has no meter, no text link, no language
    const thirdHymnSection = result.split("3. He Leadeth Me")[1]?.split(/\d+\./)[0] ?? "";
    expect(thirdHymnSection).not.toContain("Meter:");
    expect(thirdHymnSection).not.toContain("Language:");
    expect(thirdHymnSection).not.toContain("Link:");
  });

  it("shows (untitled) when title is missing", async () => {
    mockFetch([{ "number of hymnals": 10 }]);
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Psalm 23" });

    expect(result).toContain("1. (untitled)");
  });

  it("respects max_results parameter", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Psalm 23", max_results: 2 });

    expect(result).toContain("2 of 3");
    expect(result).toContain("1. The Lord Is My Shepherd");
    expect(result).toContain("2. My Shepherd Will Supply My Need");
    expect(result).not.toContain("3. He Leadeth Me");
  });

  it("caps max_results at 100", async () => {
    const manyHymns = Array.from({ length: 110 }, (_, i) => ({
      title: `Hymn ${i + 1}`,
      "number of hymnals": 10,
    }));
    mockFetch(manyHymns);
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Psalm 23", max_results: 200 });

    expect(result).toContain("100.");
    expect(result).not.toContain("101.");
  });

  it("clamps max_results to minimum of 1", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Psalm 23", max_results: 0 });

    expect(result).toContain("1 of 3");
    expect(result).toContain("1. The Lord Is My Shepherd");
    expect(result).not.toContain("2.");
  });

  it("returns friendly message when no hymns found (reference)", async () => {
    mockFetch([]);
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Obadiah 1:21" });

    expect(result).toContain('No hymns found for "Obadiah 1:21"');
  });

  it("returns friendly message when no hymns found (book mode)", async () => {
    mockFetch([]);
    const tool = getHymnTool();
    const result = await tool.execute({ book: "Obadiah", fromChapter: 1 });

    expect(result).toContain('No hymns found for "Obadiah 1"');
  });

  it("returns friendly message when response is not array", async () => {
    mockFetch({ error: "invalid" });
    const tool = getHymnTool();
    const result = await tool.execute({ reference: "Psalm 23" });

    expect(result).toContain('No hymns found for "Psalm 23"');
  });

  it("throws when neither reference nor book provided", async () => {
    const tool = getHymnTool();
    await expect(tool.execute({})).rejects.toThrow(
      "Provide either 'reference'",
    );
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tool = getHymnTool();
    await expect(
      tool.execute({ reference: "Psalm 23" }),
    ).rejects.toThrow("Hymnary API HTTP 500");
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getHymnTool();
    await expect(
      tool.execute({ reference: "Psalm 23" }),
    ).rejects.toThrow("Network error");
  });

  it("passes AbortSignal for timeout", async () => {
    mockFetch(hymnResponse);
    const tool = getHymnTool();
    await tool.execute({ reference: "Psalm 23" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.signal).toBeDefined();
  });

  it("uses passage description from book when reference is not provided", async () => {
    mockFetch(singleHymnResponse);
    const tool = getHymnTool();
    const result = await tool.execute({ book: "Ephesians", fromChapter: 2 });

    expect(result).toContain("Hymns for Ephesians 2");
  });
});
