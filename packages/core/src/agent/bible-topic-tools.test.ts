import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBibleTopicTools } from "./bible-topic-tools.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const topicsResponse = {
  response_code: 200,
  topics: [
    {
      topicid: "1",
      topicname: "Love",
      topickeywords: "love, charity, compassion",
    },
    {
      topicid: "2",
      topicname: "Faith",
      topickeywords: "faith, trust, belief",
    },
    {
      topicid: "3",
      topicname: "Forgiveness",
      topickeywords: "forgive, mercy, pardon",
    },
  ],
};

const topicVersesResponse = {
  response_code: 200,
  topicid: 1,
  topic: "Love",
  keywords: "love, charity, compassion",
  verses: [
    {
      fullpassage: "John 3:16",
      book: 43,
      bookname: "John",
      chapter: 3,
      startingverse: 16,
      endingverse: 16,
      singleverse: "3:16",
      upvotes: 42,
      "text-kjv":
        "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
      "text-web":
        "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.",
      "text-ulb":
        "For God so loved the world that he gave his only begotten Son, so that everyone who believes in him would not perish but have everlasting life.",
      "text-net":
        'For this is the way God loved the world: He gave his one and only <span class="smcaps">Son</span>.',
    },
    {
      fullpassage: "1 Corinthians 13:4-7",
      book: 46,
      bookname: "1 Corinthians",
      chapter: 13,
      startingverse: 4,
      endingverse: 7,
      singleverse: "13:4",
      upvotes: 30,
      "text-kjv":
        "Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up.",
      "text-web":
        "Love is patient and is kind. Love doesn't envy. Love doesn't brag, is not proud.",
    },
    {
      fullpassage: "Romans 8:38-39",
      book: 45,
      bookname: "Romans",
      chapter: 8,
      startingverse: 38,
      endingverse: 39,
      singleverse: "8:38",
      upvotes: 25,
      "text-kjv":
        "For I am persuaded, that neither death, nor life, nor angels, nor principalities...",
    },
  ],
};

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createBibleTopicTools", () => {
  it("returns two tools", () => {
    const tools = createBibleTopicTools();
    expect(tools).toHaveLength(2);
  });

  it("has bible_topics_list and bible_topic_verses", () => {
    const tools = createBibleTopicTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("bible_topics_list");
    expect(names).toContain("bible_topic_verses");
  });

  it("all tools have defaultPolicy allow", () => {
    const tools = createBibleTopicTools();
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe("allow");
    }
  });

  it("all tools have parameters and execute", () => {
    const tools = createBibleTopicTools();
    for (const tool of tools) {
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// bible_topics_list
// ---------------------------------------------------------------------------

describe("bible_topics_list", () => {
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

  function getTopicsListTool() {
    return createBibleTopicTools().find((t) => t.name === "bible_topics_list")!;
  }

  it("constructs correct URL", async () => {
    mockFetch(topicsResponse);
    const tool = getTopicsListTool();
    await tool.execute({});

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("biblebytopic.com/api/gettopics");
  });

  it("formats topics list correctly", async () => {
    mockFetch(topicsResponse);
    const tool = getTopicsListTool();
    const result = await tool.execute({});

    expect(result).toContain("Bible Topics (3 found):");
    expect(result).toContain("1. Love");
    expect(result).toContain("love, charity, compassion");
    expect(result).toContain("2. Faith");
    expect(result).toContain("3. Forgiveness");
  });

  it("filters topics by search keyword on topic name", async () => {
    mockFetch(topicsResponse);
    const tool = getTopicsListTool();
    const result = await tool.execute({ search: "faith" });

    expect(result).toContain("Bible Topics (1 found):");
    expect(result).toContain("2. Faith");
    expect(result).not.toContain("1. Love");
    expect(result).not.toContain("3. Forgiveness");
  });

  it("filters topics by search keyword on topic keywords", async () => {
    mockFetch(topicsResponse);
    const tool = getTopicsListTool();
    const result = await tool.execute({ search: "mercy" });

    expect(result).toContain("Bible Topics (1 found):");
    expect(result).toContain("3. Forgiveness");
  });

  it("search is case-insensitive", async () => {
    mockFetch(topicsResponse);
    const tool = getTopicsListTool();
    const result = await tool.execute({ search: "LOVE" });

    expect(result).toContain("1. Love");
  });

  it("returns friendly message when search has no matches", async () => {
    mockFetch(topicsResponse);
    const tool = getTopicsListTool();
    const result = await tool.execute({ search: "xyznonexistent" });

    expect(result).toContain('No topics found matching "xyznonexistent"');
  });

  it("returns friendly message when no topics available", async () => {
    mockFetch({ response_code: 200, topics: [] });
    const tool = getTopicsListTool();
    const result = await tool.execute({});

    expect(result).toContain("No topics available.");
  });

  it("returns friendly message when topics array is null", async () => {
    mockFetch({ response_code: 200, topics: null });
    const tool = getTopicsListTool();
    const result = await tool.execute({});

    expect(result).toContain("No topics available.");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tool = getTopicsListTool();
    await expect(tool.execute({})).rejects.toThrow(
      "BibleByTopic API HTTP 500",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getTopicsListTool();
    await expect(tool.execute({})).rejects.toThrow("Network error");
  });

  it("shows dash separator for keywords", async () => {
    mockFetch(topicsResponse);
    const tool = getTopicsListTool();
    const result = await tool.execute({});

    // Each topic line should have " — " before keywords
    expect(result).toContain("1. Love — love, charity, compassion");
  });

  it("omits keyword separator when keywords empty", async () => {
    mockFetch({
      response_code: 200,
      topics: [{ topicid: "1", topicname: "Test", topickeywords: "" }],
    });
    const tool = getTopicsListTool();
    const result = await tool.execute({});

    expect(result).toContain("1. Test");
    expect(result).not.toContain(" — ");
  });
});

// ---------------------------------------------------------------------------
// bible_topic_verses
// ---------------------------------------------------------------------------

describe("bible_topic_verses", () => {
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

  function getVersesTool() {
    return createBibleTopicTools().find(
      (t) => t.name === "bible_topic_verses",
    )!;
  }

  it("constructs correct URL with topic_id", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    await tool.execute({ topic_id: 1 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("biblebytopic.com/api/getversesfortopic/1");
  });

  it("formats verses with default KJV translation", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1 });

    expect(result).toContain("Topic: Love");
    expect(result).toContain("Keywords: love, charity, compassion");
    expect(result).toContain("KJV");
    expect(result).toContain("1. John 3:16");
    expect(result).toContain("For God so loved the world, that he gave his only begotten Son");
    expect(result).toContain("2. 1 Corinthians 13:4-7");
    expect(result).toContain("Charity suffereth long");
  });

  it("uses WEB translation when specified", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1, translation: "web" });

    expect(result).toContain("WEB");
    expect(result).toContain(
      "For God so loved the world, that he gave his one and only Son",
    );
    expect(result).toContain("Love is patient and is kind");
  });

  it("uses ULB translation when specified", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1, translation: "ulb" });

    expect(result).toContain("ULB");
    expect(result).toContain("For God so loved the world that he gave his only begotten Son");
  });

  it("falls back to KJV when requested translation is missing", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1, translation: "ulb" });

    // Third verse (Romans 8:38-39) only has KJV text
    expect(result).toContain("3. Romans 8:38-39");
    expect(result).toContain("For I am persuaded");
  });

  it("strips HTML tags from verse text", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1, translation: "net" });

    expect(result).not.toContain("<span");
    expect(result).not.toContain("</span>");
    expect(result).toContain("Son");
  });

  it("respects max_results parameter", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1, max_results: 2 });

    expect(result).toContain("Showing 2 of 3 verses");
    expect(result).toContain("1. John 3:16");
    expect(result).toContain("2. 1 Corinthians 13:4-7");
    expect(result).not.toContain("3. Romans 8:38-39");
  });

  it("caps max_results at 30", async () => {
    const manyVerses = {
      ...topicVersesResponse,
      verses: Array.from({ length: 40 }, (_, i) => ({
        fullpassage: `Genesis ${i + 1}:1`,
        book: 1,
        bookname: "Genesis",
        chapter: i + 1,
        startingverse: 1,
        endingverse: 1,
        singleverse: `${i + 1}:1`,
        upvotes: 1,
        "text-kjv": `Verse ${i + 1}`,
      })),
    };
    mockFetch(manyVerses);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1, max_results: 50 });

    expect(result).toContain("30.");
    expect(result).not.toContain("31.");
  });

  it("clamps max_results to minimum of 1", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1, max_results: 0 });

    expect(result).toContain("Showing 1 of 3 verses");
    expect(result).toContain("1. John 3:16");
    expect(result).not.toContain("2.");
  });

  it("shows verse count header", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1 });

    expect(result).toContain("Showing 3 of 3 verses (KJV):");
  });

  it("throws on missing topic_id parameter", async () => {
    const tool = getVersesTool();
    await expect(tool.execute({})).rejects.toThrow(
      "'topic_id' parameter is required",
    );
  });

  it("returns friendly message when no verses for topic", async () => {
    mockFetch({
      response_code: 200,
      topicid: 999,
      topic: "Unknown",
      keywords: "",
      verses: [],
    });
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 999 });

    expect(result).toContain("No verses found for topic ID 999");
  });

  it("returns friendly message when verses array is null", async () => {
    mockFetch({
      response_code: 200,
      topicid: 999,
      topic: "Unknown",
      keywords: "",
      verses: null,
    });
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 999 });

    expect(result).toContain("No verses found for topic ID 999");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const tool = getVersesTool();
    await expect(tool.execute({ topic_id: 1 })).rejects.toThrow(
      "BibleByTopic API HTTP 503",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getVersesTool();
    await expect(tool.execute({ topic_id: 1 })).rejects.toThrow(
      "Network error",
    );
  });

  it("translation parameter is case-insensitive", async () => {
    mockFetch(topicVersesResponse);
    const tool = getVersesTool();
    const result = await tool.execute({ topic_id: 1, translation: "WEB" });

    expect(result).toContain("WEB");
    expect(result).toContain(
      "For God so loved the world, that he gave his one and only Son",
    );
  });
});
