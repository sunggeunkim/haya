import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNetBibleTools } from "./netbible-tools.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const singleVerseResponse = [
  {
    bookname: "John",
    chapter: "3",
    verse: "16",
    text: 'For this is the way God loved the world: He gave his one and only <span class="smcaps">Son</span>, so that everyone who believes in him will not perish but have eternal life.',
  },
];

const multiVerseResponse = [
  {
    bookname: "Romans",
    chapter: "8",
    verse: "28",
    text: "And we know that all things work together for good for those who love God, who are called according to his purpose,",
  },
  {
    bookname: "Romans",
    chapter: "8",
    verse: "29",
    text: "because those whom he foreknew he also predestined to be conformed to the image of his Son, that his Son would be the firstborn among many brothers and sisters.",
  },
  {
    bookname: "Romans",
    chapter: "8",
    verse: "30",
    text: "And those he predestined, he also called; and those he called, he also justified; and those he justified, he also glorified.",
  },
];

const randomVerseResponse = [
  {
    bookname: "Proverbs",
    chapter: "3",
    verse: "5",
    text: "Trust in the <span class=\"smcaps\">Lord</span> with all your heart, and do not rely on your own understanding.",
  },
];

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createNetBibleTools", () => {
  it("returns two tools", () => {
    const tools = createNetBibleTools();
    expect(tools).toHaveLength(2);
  });

  it("has netbible_lookup and netbible_random", () => {
    const tools = createNetBibleTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("netbible_lookup");
    expect(names).toContain("netbible_random");
  });

  it("all tools have defaultPolicy allow", () => {
    const tools = createNetBibleTools();
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe("allow");
    }
  });

  it("all tools have parameters and execute", () => {
    const tools = createNetBibleTools();
    for (const tool of tools) {
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// netbible_lookup
// ---------------------------------------------------------------------------

describe("netbible_lookup", () => {
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
    return createNetBibleTools().find((t) => t.name === "netbible_lookup")!;
  }

  it("constructs correct URL with passage parameter", async () => {
    mockFetch(singleVerseResponse);
    const tool = getLookupTool();
    await tool.execute({ passage: "John 3:16" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("labs.bible.org/api");
    expect(url).toContain("passage=John%203%3A16");
    expect(url).toContain("type=json");
  });

  it("URL-encodes the passage parameter", async () => {
    mockFetch(multiVerseResponse);
    const tool = getLookupTool();
    await tool.execute({ passage: "Romans 8:28-30" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("passage=Romans%208%3A28-30");
  });

  it("formats single verse correctly", async () => {
    mockFetch(singleVerseResponse);
    const tool = getLookupTool();
    const result = await tool.execute({ passage: "John 3:16" });

    expect(result).toContain("John 3:16 (NET Bible)");
    expect(result).toContain("16 For this is the way God loved the world");
  });

  it("strips HTML tags from verse text", async () => {
    mockFetch(singleVerseResponse);
    const tool = getLookupTool();
    const result = await tool.execute({ passage: "John 3:16" });

    expect(result).not.toContain("<span");
    expect(result).not.toContain("</span>");
    expect(result).not.toContain("smcaps");
    expect(result).toContain("Son");
  });

  it("formats multi-verse range correctly", async () => {
    mockFetch(multiVerseResponse);
    const tool = getLookupTool();
    const result = await tool.execute({ passage: "Romans 8:28-30" });

    expect(result).toContain("Romans 8:28-30 (NET Bible)");
    expect(result).toContain("28 And we know that all things work together");
    expect(result).toContain("29 because those whom he foreknew");
    expect(result).toContain("30 And those he predestined");
  });

  it("throws on missing passage parameter", async () => {
    const tool = getLookupTool();
    await expect(tool.execute({})).rejects.toThrow(
      "'passage' parameter is required",
    );
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const tool = getLookupTool();
    await expect(tool.execute({ passage: "Fake 99:99" })).rejects.toThrow(
      "NET Bible API HTTP 404",
    );
  });

  it("throws when no verses found (empty array)", async () => {
    mockFetch([]);
    const tool = getLookupTool();
    await expect(tool.execute({ passage: "Fake 99:99" })).rejects.toThrow(
      "No verses found",
    );
  });

  it("throws when response is not an array", async () => {
    mockFetch({ error: "invalid" });
    const tool = getLookupTool();
    await expect(tool.execute({ passage: "Fake 99:99" })).rejects.toThrow(
      "No verses found",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getLookupTool();
    await expect(tool.execute({ passage: "John 3:16" })).rejects.toThrow(
      "Network error",
    );
  });

  it("passes AbortSignal for timeout", async () => {
    mockFetch(singleVerseResponse);
    const tool = getLookupTool();
    await tool.execute({ passage: "John 3:16" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.signal).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// netbible_random
// ---------------------------------------------------------------------------

describe("netbible_random", () => {
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

  function getRandomTool() {
    return createNetBibleTools().find((t) => t.name === "netbible_random")!;
  }

  it("constructs correct URL with passage=random", async () => {
    mockFetch(randomVerseResponse);
    const tool = getRandomTool();
    await tool.execute({});

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("labs.bible.org/api");
    expect(url).toContain("passage=random");
    expect(url).toContain("type=json");
  });

  it("formats random verse correctly", async () => {
    mockFetch(randomVerseResponse);
    const tool = getRandomTool();
    const result = await tool.execute({});

    expect(result).toContain("Proverbs 3:5 (NET Bible)");
    expect(result).toContain("Trust in the Lord with all your heart");
  });

  it("strips HTML tags from random verse", async () => {
    mockFetch(randomVerseResponse);
    const tool = getRandomTool();
    const result = await tool.execute({});

    expect(result).not.toContain("<span");
    expect(result).not.toContain("</span>");
    expect(result).toContain("Lord");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tool = getRandomTool();
    await expect(tool.execute({})).rejects.toThrow(
      "NET Bible API HTTP 500",
    );
  });

  it("throws when no verses returned (empty array)", async () => {
    mockFetch([]);
    const tool = getRandomTool();
    await expect(tool.execute({})).rejects.toThrow(
      "Failed to retrieve a random verse",
    );
  });

  it("throws when response is not an array", async () => {
    mockFetch({ error: "invalid" });
    const tool = getRandomTool();
    await expect(tool.execute({})).rejects.toThrow(
      "Failed to retrieve a random verse",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getRandomTool();
    await expect(tool.execute({})).rejects.toThrow("Network error");
  });

  it("passes AbortSignal for timeout", async () => {
    mockFetch(randomVerseResponse);
    const tool = getRandomTool();
    await tool.execute({});

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.signal).toBeDefined();
  });
});
