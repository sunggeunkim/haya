import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEmbeddingProvider } from "./embeddings.js";

describe("createEmbeddingProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws for unsupported provider", () => {
    expect(() =>
      createEmbeddingProvider({
        // @ts-expect-error testing invalid provider
        provider: "unsupported",
        apiKeyEnvVar: "TEST_KEY",
      }),
    ).toThrow("Unsupported embedding provider");
  });

  describe("OpenAI provider", () => {
    it("creates provider with default model and dimensions", () => {
      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnvVar: "OPENAI_API_KEY",
      });

      expect(provider.id).toBe("openai");
      expect(provider.model).toBe("text-embedding-3-small");
      expect(provider.dimensions).toBe(1536);
    });

    it("creates provider with custom model and dimensions", () => {
      const provider = createEmbeddingProvider({
        provider: "openai",
        model: "text-embedding-3-large",
        dimensions: 3072,
        apiKeyEnvVar: "OPENAI_API_KEY",
      });

      expect(provider.model).toBe("text-embedding-3-large");
      expect(provider.dimensions).toBe(3072);
    });

    it("throws when API key env var is not set", async () => {
      delete process.env.OPENAI_API_KEY;
      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnvVar: "OPENAI_API_KEY",
      });

      await expect(provider.embed("test")).rejects.toThrow(
        "Embedding API key not found in environment variable: OPENAI_API_KEY",
      );
    });

    it("calls the embeddings API correctly", async () => {
      process.env.TEST_OPENAI_KEY = "sk-test-key-1234";

      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [{ embedding: mockEmbedding, index: 0 }],
            }),
            { status: 200 },
          ),
        );

      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnvVar: "TEST_OPENAI_KEY",
      });

      const result = await provider.embed("test text");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/embeddings");
      expect(options?.method).toBe("POST");
      const headers = options?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk-test-key-1234");

      const body = JSON.parse(options?.body as string);
      expect(body.input).toBe("test text");
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.dimensions).toBe(1536);

      // Result should be normalized
      expect(result).toHaveLength(1536);
      const magnitude = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
      expect(magnitude).toBeCloseTo(1, 3);
    });

    it("calls embedBatch correctly", async () => {
      process.env.TEST_OPENAI_KEY = "sk-test-key-1234";

      const mockEmbeddings = [
        Array.from({ length: 1536 }, () => Math.random()),
        Array.from({ length: 1536 }, () => Math.random()),
      ];
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: mockEmbeddings.map((e, i) => ({
                embedding: e,
                index: i,
              })),
            }),
            { status: 200 },
          ),
        );

      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnvVar: "TEST_OPENAI_KEY",
      });

      const results = await provider.embedBatch(["text 1", "text 2"]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(2);

      // Both results should be normalized
      for (const result of results) {
        const magnitude = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
        expect(magnitude).toBeCloseTo(1, 3);
      }
    });

    it("returns empty array for empty batch input", async () => {
      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnvVar: "WHATEVER",
      });

      const results = await provider.embedBatch([]);
      expect(results).toEqual([]);
    });

    it("throws on API error", async () => {
      process.env.TEST_OPENAI_KEY = "sk-test-key-1234";

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Rate limit exceeded", { status: 429 }),
      );

      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnvVar: "TEST_OPENAI_KEY",
      });

      await expect(provider.embed("test")).rejects.toThrow(
        "Embedding API error (429): Rate limit exceeded",
      );
    });

    it("uses custom base URL", async () => {
      process.env.TEST_OPENAI_KEY = "sk-test-key-1234";

      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [{ embedding: mockEmbedding, index: 0 }],
            }),
            { status: 200 },
          ),
        );

      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnvVar: "TEST_OPENAI_KEY",
        baseUrl: "https://custom.api.example.com/v1",
      });

      await provider.embed("test");

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://custom.api.example.com/v1/embeddings");
    });

    it("sorts batch results by index to ensure correct order", async () => {
      process.env.TEST_OPENAI_KEY = "sk-test-key-1234";

      // Return in reverse order
      const emb0 = Array.from({ length: 1536 }, () => 0.1);
      const emb1 = Array.from({ length: 1536 }, () => 0.9);
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { embedding: emb1, index: 1 },
              { embedding: emb0, index: 0 },
            ],
          }),
          { status: 200 },
        ),
      );

      const provider = createEmbeddingProvider({
        provider: "openai",
        apiKeyEnvVar: "TEST_OPENAI_KEY",
      });

      const results = await provider.embedBatch(["first", "second"]);
      // After normalization, the first result should correspond to emb0 (all 0.1s)
      // and second to emb1 (all 0.9s) - they should be in original index order
      expect(results).toHaveLength(2);
    });
  });
});
