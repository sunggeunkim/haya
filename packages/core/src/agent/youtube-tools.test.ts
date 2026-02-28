import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createYouTubeTools } from "./youtube-tools.js";

vi.mock("../config/secrets.js", () => ({
  requireSecret: vi.fn().mockReturnValue("test-youtube-api-key"),
}));

describe("createYouTubeTools", () => {
  it("returns 3 tools", () => {
    const tools = createYouTubeTools({ apiKeyEnvVar: "YOUTUBE_API_KEY" });
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "youtube_search",
      "youtube_video_details",
      "youtube_captions",
    ]);
  });

  it("tools have required fields", () => {
    const tools = createYouTubeTools({ apiKeyEnvVar: "YOUTUBE_API_KEY" });
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.defaultPolicy).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("all tools have allow policy", () => {
    const tools = createYouTubeTools({ apiKeyEnvVar: "YOUTUBE_API_KEY" });
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe("allow");
    }
  });
});

describe("youtube_search", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const jsonResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });

  function getTool() {
    const tools = createYouTubeTools({ apiKeyEnvVar: "YOUTUBE_API_KEY" });
    return tools.find((t) => t.name === "youtube_search")!;
  }

  it("returns formatted search results", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: { videoId: "abc123" },
            snippet: {
              title: "Test Video",
              channelTitle: "Test Channel",
              publishedAt: "2026-01-15T12:00:00Z",
              description: "A test video description",
            },
          },
        ],
      }),
    );

    const tool = getTool();
    const result = await tool.execute({ query: "test" });

    expect(result).toContain("1. Test Video");
    expect(result).toContain("Channel: Test Channel");
    expect(result).toContain("Date: 2026-01-15");
    expect(result).toContain("https://www.youtube.com/watch?v=abc123");
    expect(result).toContain("A test video description");
  });

  it("passes correct URL parameters", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    await tool.execute({ query: "cats", maxResults: 10, order: "date" });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("youtube/v3/search");
    expect(callUrl).toContain("q=cats");
    expect(callUrl).toContain("maxResults=10");
    expect(callUrl).toContain("order=date");
    expect(callUrl).toContain("type=video");
    expect(callUrl).toContain("part=snippet");
  });

  it("returns message for empty results", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    const result = await tool.execute({ query: "xyznonexistent" });
    expect(result).toBe("No videos found.");
  });

  it("throws if query is missing", async () => {
    const tool = getTool();
    await expect(tool.execute({})).rejects.toThrow("query is required");
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: vi.fn().mockResolvedValue("Forbidden"),
    });

    const tool = getTool();
    await expect(tool.execute({ query: "test" })).rejects.toThrow(
      "YouTube API HTTP 403",
    );
  });

  it("clamps maxResults to 25", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    await tool.execute({ query: "test", maxResults: 100 });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("maxResults=25");
  });

  it("clamps maxResults to minimum 1", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    await tool.execute({ query: "test", maxResults: 0 });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("maxResults=5");
  });

  it("sends User-Agent header", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    await tool.execute({ query: "test" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].headers["User-Agent"]).toBe("Haya/0.1");
  });
});

describe("youtube_video_details", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const jsonResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });

  function getTool() {
    const tools = createYouTubeTools({ apiKeyEnvVar: "YOUTUBE_API_KEY" });
    return tools.find((t) => t.name === "youtube_video_details")!;
  }

  it("returns formatted video details", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        items: [
          {
            snippet: {
              title: "Amazing Video",
              channelTitle: "Cool Channel",
              publishedAt: "2025-06-01T10:00:00Z",
              description: "A really cool video",
              tags: ["cool", "amazing"],
            },
            contentDetails: {
              duration: "PT1H2M30S",
              definition: "hd",
              caption: "true",
            },
            statistics: {
              viewCount: "1234567",
              likeCount: "50000",
              commentCount: "2000",
            },
          },
        ],
      }),
    );

    const tool = getTool();
    const result = await tool.execute({ videoId: "abc123" });

    expect(result).toContain("Title: Amazing Video");
    expect(result).toContain("Channel: Cool Channel");
    expect(result).toContain("Published: 2025-06-01");
    expect(result).toContain("Duration: 1h 2m 30s");
    expect(result).toContain("Quality: HD");
    expect(result).toContain("Captions: Yes");
    expect(result).toContain("Views: 1,234,567");
    expect(result).toContain("Likes: 50,000");
    expect(result).toContain("Comments: 2,000");
    expect(result).toContain("Tags: cool, amazing");
    expect(result).toContain("A really cool video");
    expect(result).toContain("https://www.youtube.com/watch?v=abc123");
  });

  it("passes correct API parts", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    await tool.execute({ videoId: "xyz" });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("youtube/v3/videos");
    expect(callUrl).toContain("part=snippet%2CcontentDetails%2Cstatistics");
    expect(callUrl).toContain("id=xyz");
  });

  it("returns message for unknown video ID", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    const result = await tool.execute({ videoId: "nonexistent" });
    expect(result).toBe("Video not found.");
  });

  it("throws if videoId is missing", async () => {
    const tool = getTool();
    await expect(tool.execute({})).rejects.toThrow("videoId is required");
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: vi.fn().mockResolvedValue("Bad Request"),
    });

    const tool = getTool();
    await expect(tool.execute({ videoId: "abc" })).rejects.toThrow(
      "YouTube API HTTP 400",
    );
  });

  it("handles video without tags or description", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        items: [
          {
            snippet: {
              title: "Simple Video",
              channelTitle: "Simple Channel",
              publishedAt: "2025-01-01T00:00:00Z",
              description: "",
            },
            contentDetails: {
              duration: "PT5M",
              definition: "sd",
              caption: "false",
            },
            statistics: {
              viewCount: "100",
            },
          },
        ],
      }),
    );

    const tool = getTool();
    const result = await tool.execute({ videoId: "simple" });

    expect(result).toContain("Title: Simple Video");
    expect(result).toContain("Duration: 5m");
    expect(result).toContain("Quality: SD");
    expect(result).toContain("Captions: No");
    expect(result).not.toContain("Tags:");
    expect(result).not.toContain("Likes:");
  });
});

describe("youtube_captions", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const jsonResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });

  function getTool() {
    const tools = createYouTubeTools({ apiKeyEnvVar: "YOUTUBE_API_KEY" });
    return tools.find((t) => t.name === "youtube_captions")!;
  }

  it("returns formatted caption tracks", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        items: [
          {
            snippet: {
              language: "en",
              name: "English",
              trackKind: "standard",
            },
          },
          {
            snippet: {
              language: "ko",
              name: "",
              trackKind: "ASR",
            },
          },
        ],
      }),
    );

    const tool = getTool();
    const result = await tool.execute({ videoId: "abc123" });

    expect(result).toContain("- en — English");
    expect(result).toContain("- ko (auto-generated)");
    expect(result).not.toContain("— (auto-generated)");
  });

  it("returns message when no tracks found", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    const result = await tool.execute({ videoId: "silent" });
    expect(result).toBe("No caption tracks found.");
  });

  it("passes videoId correctly", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [] }),
    );

    const tool = getTool();
    await tool.execute({ videoId: "test123" });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("youtube/v3/captions");
    expect(callUrl).toContain("videoId=test123");
    expect(callUrl).toContain("part=snippet");
  });

  it("throws if videoId is missing", async () => {
    const tool = getTool();
    await expect(tool.execute({})).rejects.toThrow("videoId is required");
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: vi.fn().mockResolvedValue("Not Found"),
    });

    const tool = getTool();
    await expect(tool.execute({ videoId: "missing" })).rejects.toThrow(
      "YouTube API HTTP 404",
    );
  });
});

describe("response truncation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("truncates long responses", async () => {
    const longDescription = "x".repeat(20_000);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        items: [
          {
            snippet: {
              title: "Long Video",
              channelTitle: "Ch",
              publishedAt: "2025-01-01T00:00:00Z",
              description: longDescription,
            },
            contentDetails: {
              duration: "PT1M",
              definition: "hd",
              caption: "false",
            },
            statistics: { viewCount: "1" },
          },
        ],
      }),
      text: vi.fn().mockResolvedValue(""),
    });

    const tools = createYouTubeTools({ apiKeyEnvVar: "YOUTUBE_API_KEY" });
    const tool = tools.find((t) => t.name === "youtube_video_details")!;
    const result = await tool.execute({ videoId: "long" });

    expect(result).toContain("[Truncated");
    expect(result.length).toBeLessThanOrEqual(16_100);
  });
});
