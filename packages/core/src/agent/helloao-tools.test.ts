import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHelloAoTools } from "./helloao-tools.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const translationsResponse = {
  translations: [
    {
      id: "BSB",
      name: "Berean Standard Bible",
      shortName: "BSB",
      englishName: "Berean Standard Bible",
      language: "eng",
      languageEnglishName: "English",
      textDirection: "ltr",
      numberOfBooks: 66,
      totalNumberOfChapters: 1189,
      totalNumberOfVerses: 31102,
      listOfBooksApiLink: "/api/BSB/books.json",
    },
    {
      id: "ENGWEBP",
      name: "World English Bible",
      shortName: "WEB",
      englishName: "World English Bible",
      language: "eng",
      languageEnglishName: "English",
      textDirection: "ltr",
      numberOfBooks: 66,
      totalNumberOfChapters: 1189,
      totalNumberOfVerses: 31102,
      listOfBooksApiLink: "/api/ENGWEBP/books.json",
    },
    {
      id: "RVA",
      name: "Reina Valera Actualizada",
      englishName: "Reina Valera Actualizada",
      language: "spa",
      languageEnglishName: "Spanish",
      textDirection: "ltr",
      numberOfBooks: 66,
      totalNumberOfChapters: 1189,
      totalNumberOfVerses: 31102,
      listOfBooksApiLink: "/api/RVA/books.json",
    },
  ],
};

const chapterResponse = {
  translation: { id: "BSB", name: "Berean Standard Bible" },
  book: { id: "JHN", name: "John" },
  chapter: {
    number: 3,
    content: [
      { type: "heading", content: ["Jesus and Nicodemus"] },
      {
        type: "verse",
        number: 1,
        content: [
          "Now there was a Pharisee named Nicodemus, a leader of the Jews.",
        ],
      },
      {
        type: "verse",
        number: 2,
        content: [
          "He came to Jesus at night and said, ",
          '"Rabbi, we know that You have come from God as a teacher."',
        ],
      },
      { type: "heading", content: ["For God So Loved the World"] },
      {
        type: "verse",
        number: 16,
        content: [
          "For God so loved the world that He gave His one and only Son, ",
          { noteId: 1 },
          " that everyone who believes in Him shall not perish but have eternal life.",
        ],
      },
    ],
  },
  numberOfVerses: 36,
  thisChapterLink: "/api/BSB/JHN/3.json",
  nextChapterApiLink: "/api/BSB/JHN/4.json",
  previousChapterApiLink: "/api/BSB/JHN/2.json",
};

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createHelloAoTools", () => {
  it("returns two tools", () => {
    const tools = createHelloAoTools();
    expect(tools).toHaveLength(2);
  });

  it("has helloao_translations and helloao_chapter", () => {
    const tools = createHelloAoTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("helloao_translations");
    expect(names).toContain("helloao_chapter");
  });

  it("all tools have defaultPolicy allow", () => {
    const tools = createHelloAoTools();
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe("allow");
    }
  });

  it("all tools have parameters and execute", () => {
    const tools = createHelloAoTools();
    for (const tool of tools) {
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// helloao_translations
// ---------------------------------------------------------------------------

describe("helloao_translations", () => {
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

  function getTranslationsTool() {
    return createHelloAoTools().find(
      (t) => t.name === "helloao_translations",
    )!;
  }

  it("constructs correct URL", async () => {
    mockFetch(translationsResponse);
    const tool = getTranslationsTool();
    await tool.execute({});

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("bible.helloao.org/api/available_translations.json");
  });

  it("formats translation list correctly", async () => {
    mockFetch(translationsResponse);
    const tool = getTranslationsTool();
    const result = await tool.execute({});

    expect(result).toContain("Bible Translations (3 of 3):");
    expect(result).toContain(
      "- BSB: Berean Standard Bible (English, 66 books, 31102 verses)",
    );
    expect(result).toContain("- ENGWEBP: World English Bible");
    expect(result).toContain("- RVA: Reina Valera Actualizada (Spanish");
  });

  it("filters by language", async () => {
    mockFetch(translationsResponse);
    const tool = getTranslationsTool();
    const result = await tool.execute({ language: "Spanish" });

    expect(result).toContain("Bible Translations (1 of 1):");
    expect(result).toContain("RVA");
    expect(result).not.toContain("BSB:");
  });

  it("filters by search keyword on name", async () => {
    mockFetch(translationsResponse);
    const tool = getTranslationsTool();
    const result = await tool.execute({ search: "Berean" });

    expect(result).toContain("Bible Translations (1 of 1):");
    expect(result).toContain("BSB");
    expect(result).not.toContain("ENGWEBP");
  });

  it("filters by search keyword on ID", async () => {
    mockFetch(translationsResponse);
    const tool = getTranslationsTool();
    const result = await tool.execute({ search: "ENGWEBP" });

    expect(result).toContain("ENGWEBP");
  });

  it("search is case-insensitive", async () => {
    mockFetch(translationsResponse);
    const tool = getTranslationsTool();
    const result = await tool.execute({ search: "berean" });

    expect(result).toContain("BSB");
  });

  it("returns friendly message when no matches", async () => {
    mockFetch(translationsResponse);
    const tool = getTranslationsTool();
    const result = await tool.execute({ language: "Klingon" });

    expect(result).toContain('No translations found matching "Klingon"');
  });

  it("respects max_results parameter", async () => {
    mockFetch(translationsResponse);
    const tool = getTranslationsTool();
    const result = await tool.execute({ max_results: 2 });

    expect(result).toContain("Bible Translations (2 of 3):");
    expect(result).toContain("... and 1 more");
  });

  it("caps max_results at 50", async () => {
    const manyTranslations = {
      translations: Array.from({ length: 60 }, (_, i) => ({
        id: `T${i}`,
        name: `Translation ${i}`,
        englishName: `Translation ${i}`,
        language: "eng",
        languageEnglishName: "English",
        textDirection: "ltr",
        numberOfBooks: 66,
        totalNumberOfChapters: 1189,
        totalNumberOfVerses: 31102,
        listOfBooksApiLink: `/api/T${i}/books.json`,
      })),
    };
    mockFetch(manyTranslations);
    const tool = getTranslationsTool();
    const result = await tool.execute({ max_results: 100 });

    expect(result).toContain("50 of 60");
    expect(result).toContain("... and 10 more");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tool = getTranslationsTool();
    await expect(tool.execute({})).rejects.toThrow(
      "HelloAO API HTTP 500",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getTranslationsTool();
    await expect(tool.execute({})).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// helloao_chapter
// ---------------------------------------------------------------------------

describe("helloao_chapter", () => {
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

  function getChapterTool() {
    return createHelloAoTools().find((t) => t.name === "helloao_chapter")!;
  }

  it("constructs correct URL", async () => {
    mockFetch(chapterResponse);
    const tool = getChapterTool();
    await tool.execute({ translation: "BSB", book: "JHN", chapter: 3 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("bible.helloao.org/api/BSB/JHN/3.json");
  });

  it("uppercases book code in URL", async () => {
    mockFetch(chapterResponse);
    const tool = getChapterTool();
    await tool.execute({ translation: "BSB", book: "jhn", chapter: 3 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("/JHN/");
  });

  it("formats chapter output with headings and verses", async () => {
    mockFetch(chapterResponse);
    const tool = getChapterTool();
    const result = await tool.execute({
      translation: "BSB",
      book: "JHN",
      chapter: 3,
    });

    expect(result).toContain("John 3 (Berean Standard Bible)");
    expect(result).toContain("[Jesus and Nicodemus]");
    expect(result).toContain(
      "1 Now there was a Pharisee named Nicodemus",
    );
    expect(result).toContain("2 He came to Jesus at night and said,");
    expect(result).toContain("Rabbi");
    expect(result).toContain("[For God So Loved the World]");
    expect(result).toContain("16 For God so loved the world");
  });

  it("filters note objects from verse content", async () => {
    mockFetch(chapterResponse);
    const tool = getChapterTool();
    const result = await tool.execute({
      translation: "BSB",
      book: "JHN",
      chapter: 3,
    });

    // Verse 16 has a { noteId: 1 } object which should be filtered out
    expect(result).not.toContain("noteId");
  });

  it("filters verses by verse_start and verse_end", async () => {
    mockFetch(chapterResponse);
    const tool = getChapterTool();
    const result = await tool.execute({
      translation: "BSB",
      book: "JHN",
      chapter: 3,
      verse_start: 16,
      verse_end: 16,
    });

    expect(result).toContain("John 3:16 (Berean Standard Bible)");
    expect(result).toContain("16 For God so loved the world");
    // Verses 1 and 2 should not appear
    expect(result).not.toContain("1 Now there was a Pharisee");
    expect(result).not.toContain("2 He came to Jesus");
  });

  it("shows no range suffix for full chapter", async () => {
    mockFetch(chapterResponse);
    const tool = getChapterTool();
    const result = await tool.execute({
      translation: "BSB",
      book: "JHN",
      chapter: 3,
    });

    // Full chapter: "John 3 (" not "John 3:"
    expect(result).toMatch(/^John 3 \(/);
  });

  it("throws on missing translation parameter", async () => {
    const tool = getChapterTool();
    await expect(
      tool.execute({ book: "JHN", chapter: 3 }),
    ).rejects.toThrow("'translation' parameter is required");
  });

  it("throws on missing book parameter", async () => {
    const tool = getChapterTool();
    await expect(
      tool.execute({ translation: "BSB", chapter: 3 }),
    ).rejects.toThrow("'book' parameter is required");
  });

  it("throws on missing chapter parameter", async () => {
    const tool = getChapterTool();
    await expect(
      tool.execute({ translation: "BSB", book: "JHN" }),
    ).rejects.toThrow("'chapter' parameter is required");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const tool = getChapterTool();
    await expect(
      tool.execute({ translation: "BSB", book: "JHN", chapter: 999 }),
    ).rejects.toThrow("HelloAO API HTTP 404");
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getChapterTool();
    await expect(
      tool.execute({ translation: "BSB", book: "JHN", chapter: 3 }),
    ).rejects.toThrow("Network error");
  });
});
