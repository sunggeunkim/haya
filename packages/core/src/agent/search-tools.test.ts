import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSearchTools } from "./search-tools.js";

vi.mock("../config/secrets.js", () => ({
  requireSecret: vi.fn().mockReturnValue("test-brave-api-key"),
}));

describe("createSearchTools", () => {
  it("returns one tool", () => {
    const tools = createSearchTools("BRAVE_API_KEY");
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("web_search");
  });

  it("tool has required fields", () => {
    const tools = createSearchTools("BRAVE_API_KEY");
    const tool = tools[0];
    expect(tool.name).toBeTruthy();
    expect(tool.description).toBeTruthy();
    expect(tool.defaultPolicy).toBe("allow");
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe("function");
  });
});

describe("web_search", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls Brave Search API with correct params", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        web: {
          results: [
            {
              title: "Example Result",
              url: "https://example.com",
              description: "An example search result",
            },
          ],
        },
      }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools("BRAVE_API_KEY");
    const search = tools[0];
    const result = await search.execute({ query: "test query" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "test-brave-api-key",
        }),
      }),
    );
    expect(result).toContain("Example Result");
    expect(result).toContain("https://example.com");
    expect(result).toContain("An example search result");
  });

  it("formats multiple results with numbering", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        web: {
          results: [
            {
              title: "First",
              url: "https://first.com",
              description: "First result",
            },
            {
              title: "Second",
              url: "https://second.com",
              description: "Second result",
            },
          ],
        },
      }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools("BRAVE_API_KEY");
    const result = await tools[0].execute({ query: "test" });

    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
  });

  it("returns no-results message for empty results", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        web: { results: [] },
      }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools("BRAVE_API_KEY");
    const result = await tools[0].execute({ query: "nothing" });
    expect(result).toContain("No results found");
  });

  it("handles missing web field in response", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools("BRAVE_API_KEY");
    const result = await tools[0].execute({ query: "test" });
    expect(result).toContain("No results found");
  });

  it("throws on API error", async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools("BRAVE_API_KEY");
    await expect(tools[0].execute({ query: "test" })).rejects.toThrow(
      "Brave Search API HTTP 429",
    );
  });

  it("throws if query is missing", async () => {
    const tools = createSearchTools("BRAVE_API_KEY");
    await expect(tools[0].execute({})).rejects.toThrow("query is required");
  });

  it("caps count at 20", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ web: { results: [] } }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools("BRAVE_API_KEY");
    await tools[0].execute({ query: "test", count: 50 });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("count=20");
  });
});
