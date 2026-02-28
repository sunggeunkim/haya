import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBibleTools } from "./bible-tools.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const singleVerseResponse = {
  reference: "John 3:16",
  verses: [
    {
      book_id: "JHN",
      book_name: "John",
      chapter: 3,
      verse: 16,
      text: "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.\n",
    },
  ],
  text: "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.\n",
  translation_id: "web",
  translation_name: "World English Bible",
};

const multiVerseResponse = {
  reference: "Genesis 1:1-3",
  verses: [
    {
      book_id: "GEN",
      book_name: "Genesis",
      chapter: 1,
      verse: 1,
      text: "In the beginning, God created the heavens and the earth.\n",
    },
    {
      book_id: "GEN",
      book_name: "Genesis",
      chapter: 1,
      verse: 2,
      text: "The earth was formless and empty. Darkness was on the surface of the deep and God's Spirit was hovering over the surface of the waters.\n",
    },
    {
      book_id: "GEN",
      book_name: "Genesis",
      chapter: 1,
      verse: 3,
      text: 'God said, "Let there be light," and there was light.\n',
    },
  ],
  text: 'In the beginning, God created the heavens and the earth.\nThe earth was formless and empty. Darkness was on the surface of the deep and God\'s Spirit was hovering over the surface of the waters.\nGod said, "Let there be light," and there was light.\n',
  translation_id: "web",
  translation_name: "World English Bible",
};

const searchResponse = {
  results: [
    {
      pk: 100,
      translation: "YLT",
      book: 1,
      chapter: 22,
      verse: 2,
      text: "and He saith, `Take, I pray thee, thy son, thine only one, whom thou hast <mark>loved</mark>, Isaac",
    },
    {
      pk: 200,
      translation: "YLT",
      book: 43,
      chapter: 3,
      verse: 16,
      text: "for God did so <mark>love</mark> the world, that His Son",
    },
  ],
  exact_matches: 2,
  total: 430,
};

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createBibleTools", () => {
  it("returns two tools", () => {
    const tools = createBibleTools();
    expect(tools).toHaveLength(2);
  });

  it("has bible_lookup and bible_search", () => {
    const tools = createBibleTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("bible_lookup");
    expect(names).toContain("bible_search");
  });

  it("all tools have defaultPolicy allow", () => {
    const tools = createBibleTools();
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe("allow");
    }
  });

  it("all tools have parameters and execute", () => {
    const tools = createBibleTools();
    for (const tool of tools) {
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// bible_lookup
// ---------------------------------------------------------------------------

describe("bible_lookup", () => {
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

  function getLookupTool() {
    return createBibleTools().find((t) => t.name === "bible_lookup")!;
  }

  it("constructs correct URL with default translation", async () => {
    mockFetch(singleVerseResponse);
    const tool = getLookupTool();
    await tool.execute({ reference: "John 3:16" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("bible-api.com/John%203%3A16");
    expect(url).toContain("translation=web");
  });

  it("uses custom translation parameter", async () => {
    mockFetch(singleVerseResponse);
    const tool = getLookupTool();
    await tool.execute({ reference: "John 3:16", translation: "kjv" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("translation=kjv");
  });

  it("formats single verse correctly", async () => {
    mockFetch(singleVerseResponse);
    const tool = getLookupTool();
    const result = await tool.execute({ reference: "John 3:16" });

    expect(result).toContain("John 3:16 (World English Bible)");
    expect(result).toContain("16 For God so loved the world");
  });

  it("formats multi-verse range correctly", async () => {
    mockFetch(multiVerseResponse);
    const tool = getLookupTool();
    const result = await tool.execute({ reference: "Genesis 1:1-3" });

    expect(result).toContain("Genesis 1:1-3 (World English Bible)");
    expect(result).toContain("1 In the beginning");
    expect(result).toContain("2 The earth was formless");
    expect(result).toContain("3 God said");
  });

  it("throws on missing reference parameter", async () => {
    const tool = getLookupTool();
    await expect(tool.execute({})).rejects.toThrow(
      "'reference' parameter is required",
    );
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const tool = getLookupTool();
    await expect(tool.execute({ reference: "Fake 99:99" })).rejects.toThrow(
      "Bible API HTTP 404",
    );
  });

  it("throws when no verses found", async () => {
    mockFetch({ reference: "Fake 99:99", verses: [], text: "", translation_id: "web", translation_name: "WEB" });
    const tool = getLookupTool();
    await expect(tool.execute({ reference: "Fake 99:99" })).rejects.toThrow(
      "No verses found",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getLookupTool();
    await expect(tool.execute({ reference: "John 3:16" })).rejects.toThrow(
      "Network error",
    );
  });
});

// ---------------------------------------------------------------------------
// bible_search
// ---------------------------------------------------------------------------

describe("bible_search", () => {
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
    return createBibleTools().find((t) => t.name === "bible_search")!;
  }

  it("constructs correct URL with default translation", async () => {
    mockFetch(searchResponse);
    const tool = getSearchTool();
    await tool.execute({ query: "love" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("bolls.life/v2/find/YLT");
    expect(url).toContain("search=love");
  });

  it("URL-encodes the query", async () => {
    mockFetch({ results: [], exact_matches: 0, total: 0 });
    const tool = getSearchTool();
    await tool.execute({ query: "God's love" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("search=God's%20love");
  });

  it("strips <mark> tags from result text", async () => {
    mockFetch(searchResponse);
    const tool = getSearchTool();
    const result = await tool.execute({ query: "love" });

    expect(result).not.toContain("<mark>");
    expect(result).not.toContain("</mark>");
    expect(result).toContain("loved");
    expect(result).toContain("love");
  });

  it("maps book number to book name", async () => {
    mockFetch(searchResponse);
    const tool = getSearchTool();
    const result = await tool.execute({ query: "love" });

    expect(result).toContain("Genesis 22:2");
    expect(result).toContain("John 3:16");
  });

  it("falls back to 'Book N' for unknown book numbers", async () => {
    mockFetch({
      results: [
        { pk: 1, translation: "YLT", book: 999, chapter: 1, verse: 1, text: "test" },
      ],
      exact_matches: 1,
      total: 1,
    });
    const tool = getSearchTool();
    const result = await tool.execute({ query: "test" });

    expect(result).toContain("Book 999");
  });

  it("caps max_results at 20", async () => {
    const manyResults = {
      results: Array.from({ length: 30 }, (_, i) => ({
        pk: i,
        translation: "YLT",
        book: 1,
        chapter: 1,
        verse: i + 1,
        text: `verse ${i + 1}`,
      })),
      exact_matches: 30,
      total: 30,
    };
    mockFetch(manyResults);
    const tool = getSearchTool();
    const result = await tool.execute({ query: "verse", max_results: 50 });

    // Should show at most 20 numbered results
    expect(result).toContain("20.");
    expect(result).not.toContain("21.");
  });

  it("respects custom max_results", async () => {
    const manyResults = {
      results: Array.from({ length: 10 }, (_, i) => ({
        pk: i,
        translation: "YLT",
        book: 1,
        chapter: 1,
        verse: i + 1,
        text: `verse ${i + 1}`,
      })),
      exact_matches: 10,
      total: 10,
    };
    mockFetch(manyResults);
    const tool = getSearchTool();
    const result = await tool.execute({ query: "verse", max_results: 3 });

    expect(result).toContain("3.");
    expect(result).not.toContain("4.");
  });

  it("shows total count and display count in header", async () => {
    mockFetch(searchResponse);
    const tool = getSearchTool();
    const result = await tool.execute({ query: "love" });

    expect(result).toContain("Found 430 matches, showing 2:");
  });

  it("returns friendly message when no results", async () => {
    mockFetch({ results: [], exact_matches: 0, total: 0 });
    const tool = getSearchTool();
    const result = await tool.execute({ query: "xyznonexistent" });

    expect(result).toContain("No results found");
    expect(result).toContain("xyznonexistent");
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
    await expect(tool.execute({ query: "love" })).rejects.toThrow(
      "Bible search API HTTP 500",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getSearchTool();
    await expect(tool.execute({ query: "love" })).rejects.toThrow(
      "Network error",
    );
  });

  it("uses custom translation", async () => {
    mockFetch({ results: [], exact_matches: 0, total: 0 });
    const tool = getSearchTool();
    await tool.execute({ query: "love", translation: "KJV" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("bolls.life/v2/find/KJV");
  });
});
