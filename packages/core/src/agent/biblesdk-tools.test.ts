import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBibleSdkTools } from "./biblesdk-tools.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const singleVerseResponse = {
  verses: [
    {
      book: "JHN",
      bookName: "John",
      chapter: 3,
      verse: 16,
      text: "For this is the way God loved the world: He gave his one and only Son.",
    },
  ],
};

const verseWithConcordance = {
  verses: [
    {
      book: "GEN",
      bookName: "Genesis",
      chapter: 1,
      verse: 1,
      text: "In the beginning God created the heavens and the earth.",
      concordance: [
        {
          strongs: "H7225",
          original: "\u05E8\u05B5\u05D0\u05E9\u05B4\u05C1\u05D9\u05EA",
          transliteration: "reshith",
          definition: "beginning, chief",
        },
        {
          strongs: "H430",
          original: "\u05D0\u05B1\u05DC\u05B9\u05D4\u05B4\u05D9\u05DD",
          transliteration: "elohim",
          definition: "God, gods",
        },
      ],
    },
  ],
};

const multiVerseResponse = {
  verses: [
    {
      book: "ROM",
      bookName: "Romans",
      chapter: 8,
      verse: 28,
      text: "And we know that all things work together for good.",
    },
    {
      book: "ROM",
      bookName: "Romans",
      chapter: 8,
      verse: 29,
      text: "Because those whom he foreknew he also predestined.",
    },
    {
      book: "ROM",
      bookName: "Romans",
      chapter: 8,
      verse: 30,
      text: "And those he predestined, he also called.",
    },
  ],
};

const searchResponse = {
  query: "love your neighbor",
  results: [
    {
      book: "LEV",
      bookName: "Leviticus",
      chapter: 19,
      verse: 18,
      text: "You must not take vengeance or bear a grudge. You shall love your neighbor as yourself.",
      score: 0.95,
    },
    {
      book: "MAT",
      bookName: "Matthew",
      chapter: 22,
      verse: 39,
      text: "The second is like it: 'Love your neighbor as yourself.'",
      score: 0.92,
    },
  ],
};

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createBibleSdkTools", () => {
  it("returns two tools", () => {
    const tools = createBibleSdkTools();
    expect(tools).toHaveLength(2);
  });

  it("has biblesdk_verse and biblesdk_search", () => {
    const tools = createBibleSdkTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("biblesdk_verse");
    expect(names).toContain("biblesdk_search");
  });

  it("all tools have defaultPolicy allow", () => {
    const tools = createBibleSdkTools();
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe("allow");
    }
  });

  it("all tools have parameters and execute", () => {
    const tools = createBibleSdkTools();
    for (const tool of tools) {
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// biblesdk_verse
// ---------------------------------------------------------------------------

describe("biblesdk_verse", () => {
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

  function getVerseTool() {
    return createBibleSdkTools().find((t) => t.name === "biblesdk_verse")!;
  }

  it("constructs correct URL for single verse", async () => {
    mockFetch(singleVerseResponse);
    const tool = getVerseTool();
    await tool.execute({ book: "JHN", chapter: 3, verse: 16 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("biblesdk.com/api/books/JHN/chapters/3/verses/16");
    expect(url).not.toContain("concordance");
  });

  it("uppercases book code in URL", async () => {
    mockFetch(singleVerseResponse);
    const tool = getVerseTool();
    await tool.execute({ book: "jhn", chapter: 3, verse: 16 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("/books/JHN/");
  });

  it("constructs URL for verse range", async () => {
    mockFetch(multiVerseResponse);
    const tool = getVerseTool();
    await tool.execute({ book: "ROM", chapter: 8, verse: 28, endVerse: 30 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("/verses/28-30");
  });

  it("adds concordance=true to URL when requested", async () => {
    mockFetch(verseWithConcordance);
    const tool = getVerseTool();
    await tool.execute({ book: "GEN", chapter: 1, verse: 1, concordance: true });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("concordance=true");
  });

  it("formats single verse correctly", async () => {
    mockFetch(singleVerseResponse);
    const tool = getVerseTool();
    const result = await tool.execute({ book: "JHN", chapter: 3, verse: 16 });

    expect(result).toContain("John 3:16 (NET Bible via Bible SDK)");
    expect(result).toContain("16 For this is the way God loved the world");
  });

  it("formats multi-verse range correctly", async () => {
    mockFetch(multiVerseResponse);
    const tool = getVerseTool();
    const result = await tool.execute({
      book: "ROM", chapter: 8, verse: 28, endVerse: 30,
    });

    expect(result).toContain("Romans 8:28-30 (NET Bible via Bible SDK)");
    expect(result).toContain("28 And we know that all things work together");
    expect(result).toContain("29 Because those whom he foreknew");
    expect(result).toContain("30 And those he predestined");
  });

  it("includes Strong's concordance data when present", async () => {
    mockFetch(verseWithConcordance);
    const tool = getVerseTool();
    const result = await tool.execute({
      book: "GEN", chapter: 1, verse: 1, concordance: true,
    });

    expect(result).toContain("Strong's Concordance:");
    expect(result).toContain("H7225");
    expect(result).toContain("reshith");
    expect(result).toContain("beginning, chief");
    expect(result).toContain("H430");
    expect(result).toContain("elohim");
    expect(result).toContain("God, gods");
  });

  it("throws on missing book parameter", async () => {
    const tool = getVerseTool();
    await expect(
      tool.execute({ chapter: 3, verse: 16 }),
    ).rejects.toThrow("'book' parameter is required");
  });

  it("throws on missing chapter parameter", async () => {
    const tool = getVerseTool();
    await expect(
      tool.execute({ book: "JHN", verse: 16 }),
    ).rejects.toThrow("'chapter' parameter is required");
  });

  it("throws on missing verse parameter", async () => {
    const tool = getVerseTool();
    await expect(
      tool.execute({ book: "JHN", chapter: 3 }),
    ).rejects.toThrow("'verse' parameter is required");
  });

  it("throws when no verses found", async () => {
    mockFetch({ verses: [] });
    const tool = getVerseTool();
    await expect(
      tool.execute({ book: "JHN", chapter: 99, verse: 99 }),
    ).rejects.toThrow("No verses found");
  });

  it("throws when verses field is null", async () => {
    mockFetch({ verses: null });
    const tool = getVerseTool();
    await expect(
      tool.execute({ book: "JHN", chapter: 99, verse: 99 }),
    ).rejects.toThrow("No verses found");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const tool = getVerseTool();
    await expect(
      tool.execute({ book: "JHN", chapter: 3, verse: 16 }),
    ).rejects.toThrow("Bible SDK API HTTP 404");
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getVerseTool();
    await expect(
      tool.execute({ book: "JHN", chapter: 3, verse: 16 }),
    ).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// biblesdk_search
// ---------------------------------------------------------------------------

describe("biblesdk_search", () => {
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

  function getSearchTool() {
    return createBibleSdkTools().find((t) => t.name === "biblesdk_search")!;
  }

  it("constructs correct URL with encoded query", async () => {
    mockFetch(searchResponse);
    const tool = getSearchTool();
    await tool.execute({ query: "love your neighbor" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("biblesdk.com/api/search");
    expect(url).toContain("query=love%20your%20neighbor");
  });

  it("formats search results correctly", async () => {
    mockFetch(searchResponse);
    const tool = getSearchTool();
    const result = await tool.execute({ query: "love your neighbor" });

    expect(result).toContain('Bible Search: "love your neighbor"');
    expect(result).toContain("Found 2 results, showing 2:");
    expect(result).toContain("1. Leviticus 19:18");
    expect(result).toContain("You shall love your neighbor as yourself");
    expect(result).toContain("2. Matthew 22:39");
  });

  it("respects max_results parameter", async () => {
    mockFetch(searchResponse);
    const tool = getSearchTool();
    const result = await tool.execute({ query: "love your neighbor", max_results: 1 });

    expect(result).toContain("Found 2 results, showing 1:");
    expect(result).toContain("1. Leviticus 19:18");
    expect(result).not.toContain("2. Matthew");
  });

  it("caps max_results at 20", async () => {
    const manyResults = {
      query: "test",
      results: Array.from({ length: 25 }, (_, i) => ({
        book: "GEN",
        bookName: "Genesis",
        chapter: 1,
        verse: i + 1,
        text: `verse ${i + 1}`,
      })),
    };
    mockFetch(manyResults);
    const tool = getSearchTool();
    const result = await tool.execute({ query: "test", max_results: 50 });

    expect(result).toContain("20.");
    expect(result).not.toContain("21.");
  });

  it("returns friendly message when no results", async () => {
    mockFetch({ query: "xyznonexistent", results: [] });
    const tool = getSearchTool();
    const result = await tool.execute({ query: "xyznonexistent" });

    expect(result).toContain('No results found for "xyznonexistent"');
  });

  it("returns friendly message when results is null", async () => {
    mockFetch({ query: "test", results: null });
    const tool = getSearchTool();
    const result = await tool.execute({ query: "test" });

    expect(result).toContain('No results found for "test"');
  });

  it("throws on missing query parameter", async () => {
    const tool = getSearchTool();
    await expect(tool.execute({})).rejects.toThrow(
      "'query' parameter is required",
    );
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tool = getSearchTool();
    await expect(
      tool.execute({ query: "love" }),
    ).rejects.toThrow("Bible SDK API HTTP 500");
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getSearchTool();
    await expect(
      tool.execute({ query: "love" }),
    ).rejects.toThrow("Network error");
  });
});
