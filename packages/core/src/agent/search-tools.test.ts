import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSearchTools } from "./search-tools.js";

vi.mock("../config/secrets.js", () => ({
  requireSecret: vi.fn().mockReturnValue("test-api-key"),
}));

describe("createSearchTools", () => {
  it("returns one tool", () => {
    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("web_search");
  });

  it("tool has required fields", () => {
    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
    const tool = tools[0];
    expect(tool.name).toBeTruthy();
    expect(tool.description).toBeTruthy();
    expect(tool.defaultPolicy).toBe("allow");
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe("function");
  });
});

describe("web_search (brave)", () => {
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

    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
    const search = tools[0];
    const result = await search.execute({ query: "test query" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "test-api-key",
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

    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
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

    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
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

    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
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

    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
    await expect(tools[0].execute({ query: "test" })).rejects.toThrow(
      "Brave Search API HTTP 429",
    );
  });

  it("throws if query is missing", async () => {
    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
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

    const tools = createSearchTools([{ provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" }]);
    await tools[0].execute({ query: "test", count: 50 });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("count=20");
  });
});

describe("web_search (google)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls Google CSE API with correct params", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        items: [
          {
            title: "Google Result",
            link: "https://google-result.com",
            snippet: "A Google CSE result",
          },
        ],
      }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools([{
      provider: "google",
      apiKeyEnvVar: "GOOGLE_CSE_API_KEY",
      searchEngineId: "my-search-engine-id",
    }]);
    const result = await tools[0].execute({ query: "test query" });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("googleapis.com/customsearch/v1");
    expect(callUrl).toContain("key=test-api-key");
    expect(callUrl).toContain("cx=my-search-engine-id");
    expect(callUrl).toContain("q=test+query");

    expect(result).toContain("Google Result");
    expect(result).toContain("https://google-result.com");
    expect(result).toContain("A Google CSE result");
  });

  it("formats Google results with numbering", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        items: [
          { title: "First", link: "https://first.com", snippet: "First result" },
          { title: "Second", link: "https://second.com", snippet: "Second result" },
        ],
      }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools([{
      provider: "google",
      apiKeyEnvVar: "GOOGLE_CSE_API_KEY",
      searchEngineId: "cse-id",
    }]);
    const result = await tools[0].execute({ query: "test" });

    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
  });

  it("returns no-results message for empty Google response", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools([{
      provider: "google",
      apiKeyEnvVar: "GOOGLE_CSE_API_KEY",
      searchEngineId: "cse-id",
    }]);
    const result = await tools[0].execute({ query: "nothing" });
    expect(result).toContain("No results found");
  });

  it("throws on Google API error", async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      statusText: "Forbidden",
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools([{
      provider: "google",
      apiKeyEnvVar: "GOOGLE_CSE_API_KEY",
      searchEngineId: "cse-id",
    }]);
    await expect(tools[0].execute({ query: "test" })).rejects.toThrow(
      "Google CSE API HTTP 403",
    );
  });

  it("throws if searchEngineId is missing for Google provider", async () => {
    const tools = createSearchTools([{
      provider: "google",
      apiKeyEnvVar: "GOOGLE_CSE_API_KEY",
    }]);
    await expect(tools[0].execute({ query: "test" })).rejects.toThrow(
      "searchEngineId is required for the Google CSE provider",
    );
  });

  it("caps num at 10 for Google CSE", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [] }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools([{
      provider: "google",
      apiKeyEnvVar: "GOOGLE_CSE_API_KEY",
      searchEngineId: "cse-id",
    }]);
    await tools[0].execute({ query: "test", count: 50 });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("num=10");
  });
});

describe("web_search (tavily)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls Tavily Search API with correct params", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          {
            title: "Tavily Result",
            url: "https://tavily-result.com",
            content: "A Tavily search result",
          },
        ],
      }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools([{
      provider: "tavily",
      apiKeyEnvVar: "TAVILY_API_KEY",
    }]);
    const result = await tools[0].execute({ query: "test query" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
        }),
      }),
    );

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.query).toBe("test query");
    expect(body.max_results).toBe(5);

    expect(result).toContain("Tavily Result");
    expect(result).toContain("https://tavily-result.com");
    expect(result).toContain("A Tavily search result");
  });

  it("returns no-results message for empty Tavily response", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools([{
      provider: "tavily",
      apiKeyEnvVar: "TAVILY_API_KEY",
    }]);
    const result = await tools[0].execute({ query: "nothing" });
    expect(result).toContain("No results found");
  });

  it("throws on Tavily API error", async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse,
    );

    const tools = createSearchTools([{
      provider: "tavily",
      apiKeyEnvVar: "TAVILY_API_KEY",
    }]);
    await expect(tools[0].execute({ query: "test" })).rejects.toThrow(
      "Tavily Search API HTTP 429",
    );
  });
});

describe("web_search fallback chain", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("falls back to next provider when first fails", async () => {
    let callCount = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        callCount++;
        if (url.includes("googleapis.com")) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              web: {
                results: [
                  {
                    title: "Brave Fallback",
                    url: "https://brave-fallback.com",
                    description: "Result from Brave fallback",
                  },
                ],
              },
            }),
        });
      },
    );

    const tools = createSearchTools([
      { provider: "google", apiKeyEnvVar: "GOOGLE_KEY", searchEngineId: "cse-id" },
      { provider: "brave", apiKeyEnvVar: "BRAVE_KEY" },
    ]);
    const result = await tools[0].execute({ query: "test" });

    expect(callCount).toBe(2);
    expect(result).toContain("Brave Fallback");
  });

  it("throws last error when all providers fail", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes("googleapis.com")) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        });
      },
    );

    const tools = createSearchTools([
      { provider: "google", apiKeyEnvVar: "GOOGLE_KEY", searchEngineId: "cse-id" },
      { provider: "brave", apiKeyEnvVar: "BRAVE_KEY" },
    ]);

    await expect(tools[0].execute({ query: "test" })).rejects.toThrow(
      "Brave Search API HTTP 500",
    );
  });

  it("does not try second provider when first succeeds", async () => {
    let callCount = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            web: {
              results: [
                {
                  title: "First Provider",
                  url: "https://first.com",
                  description: "Result from first",
                },
              ],
            },
          }),
      });
    });

    const tools = createSearchTools([
      { provider: "brave", apiKeyEnvVar: "BRAVE_KEY" },
      { provider: "brave", apiKeyEnvVar: "BRAVE_KEY_2" },
    ]);
    const result = await tools[0].execute({ query: "test" });

    expect(callCount).toBe(1);
    expect(result).toContain("First Provider");
  });
});
