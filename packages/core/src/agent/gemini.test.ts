import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiProvider, formatGeminiMessages } from "./gemini.js";
import { createProvider } from "./providers.js";
import { ProviderHttpError, RetryableProviderError } from "./retry.js";
import type { CompletionResponse, Message } from "./types.js";

vi.mock("../config/secrets.js", () => ({
  resolveSecret: (name: string) => process.env[name],
  requireSecret: (name: string) => {
    const v = process.env[name];
    if (!v) throw new Error(`Required env var "${name}" is not set`);
    return v;
  },
}));

/**
 * Helper: builds a ReadableStream<Uint8Array> from an array of SSE-formatted strings.
 */
function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = events.join("");
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

/** Collect all yielded deltas and the final return value from an async generator. */
async function collectStream(gen: AsyncGenerator<unknown, unknown>) {
  const deltas: unknown[] = [];
  let result: unknown;
  while (true) {
    const next = await gen.next();
    if (next.done) {
      result = next.value;
      break;
    }
    deltas.push(next.value);
  }
  return { deltas, result };
}

// ---------------------------------------------------------------------------
// createProvider dispatch
// ---------------------------------------------------------------------------

describe("createProvider — gemini and ollama cases", () => {
  it("creates a Gemini provider via createProvider", () => {
    const provider = createProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "GEMINI_API_KEY",
    });
    expect(provider.name).toBe("gemini");
  });

  it("creates an Ollama provider via createProvider", () => {
    const provider = createProvider({
      provider: "ollama",
      model: "llama3",
    });
    expect(provider.name).toBe("ollama");
  });

  it("creates an Ollama provider with custom baseUrl", () => {
    const provider = createProvider({
      provider: "ollama",
      model: "llama3",
      baseUrl: "http://remote-host:11434/v1",
    });
    expect(provider.name).toBe("ollama");
  });
});

// ---------------------------------------------------------------------------
// createGeminiProvider
// ---------------------------------------------------------------------------

describe("createGeminiProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates a provider with name 'gemini'", () => {
    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "GEMINI_API_KEY",
    });
    expect(provider.name).toBe("gemini");
  });

  it("throws when apiKeyEnvVar is not set on config", async () => {
    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
    });

    await expect(
      provider.complete({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/apiKeyEnvVar is required/);
  });

  it("throws when the API key env var is not populated", async () => {
    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "MISSING_GEMINI_KEY_XYZ",
    });

    await expect(
      provider.complete({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key not found/);
  });
});

// ---------------------------------------------------------------------------
// Gemini complete()
// ---------------------------------------------------------------------------

describe("Gemini complete()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends correct request structure and parses response", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello from Gemini!" }],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const result = await provider.complete({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "greet",
          description: "Greet someone",
          parameters: { type: "object" },
          execute: async () => "hello",
        },
      ],
      maxTokens: 1024,
      temperature: 0.7,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-gemini-key-123",
    );
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const body = JSON.parse(options.body as string);
    expect(body.contents).toBeDefined();
    expect(body.tools).toBeDefined();
    expect(body.tools[0].functionDeclarations).toBeDefined();
    expect(body.tools[0].functionDeclarations[0].name).toBe("greet");
    expect(body.generationConfig.maxOutputTokens).toBe(1024);
    expect(body.generationConfig.temperature).toBe(0.7);

    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toBe("Hello from Gemini!");
    expect(result.finishReason).toBe("stop");
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(5);
    expect(result.usage?.totalTokens).toBe(15);
  });

  it("maps tool calls from the response correctly", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "get_weather", args: { city: "SF" } } },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 12,
        totalTokenCount: 20,
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const result = await provider.complete({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "weather?" }],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls).toHaveLength(1);
    expect(result.message.toolCalls![0].id).toBe("call_0");
    expect(result.message.toolCalls![0].name).toBe("get_weather");
    expect(result.message.toolCalls![0].arguments).toBe('{"city":"SF"}');
  });

  it("handles multiple tool calls in a single response", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              { text: "Let me check both." },
              { functionCall: { name: "get_weather", args: { city: "SF" } } },
              { functionCall: { name: "get_time", args: { tz: "PST" } } },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const result = await provider.complete({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "weather and time?" }],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.content).toBe("Let me check both.");
    expect(result.message.toolCalls).toHaveLength(2);
    expect(result.message.toolCalls![0].id).toBe("call_0");
    expect(result.message.toolCalls![0].name).toBe("get_weather");
    expect(result.message.toolCalls![1].id).toBe("call_1");
    expect(result.message.toolCalls![1].name).toBe("get_time");
  });

  it("maps MAX_TOKENS finish reason to length", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = {
      candidates: [
        {
          content: { parts: [{ text: "Truncated..." }], role: "model" },
          finishReason: "MAX_TOKENS",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const result = await provider.complete({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "write a long essay" }],
    });

    expect(result.finishReason).toBe("length");
  });

  it("throws when no candidate is returned", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = { candidates: [] };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    await expect(
      provider.complete({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/No completion candidate/);
  });

  it("returns undefined usage when response has no usageMetadata", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = {
      candidates: [
        {
          content: { parts: [{ text: "No usage" }], role: "model" },
          finishReason: "STOP",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const result = await provider.complete({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.usage).toBeUndefined();
    expect(result.message.content).toBe("No usage");
  });

  it("throws on non-retryable error response", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("bad request", { status: 400 })),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
      retryOptions: { maxRetries: 0 },
    });

    await expect(
      provider.complete({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(ProviderHttpError);
  });

  it("retries and throws on persistent retryable error", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("rate limited", { status: 429 })),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
      retryOptions: { maxRetries: 1, initialDelayMs: 10 },
    });

    await expect(
      provider.complete({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(RetryableProviderError);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("extracts system messages into systemInstruction in the request body", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = {
      candidates: [
        {
          content: { parts: [{ text: "I am helpful." }], role: "model" },
          finishReason: "STOP",
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    await provider.complete({
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "You are helpful." }],
    });
    // System messages should not appear in the contents array
    expect(
      body.contents.every((c: { role: string }) => c.role !== "system"),
    ).toBe(true);
  });

  it("sends tool role messages as functionResponse parts in the request", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = {
      candidates: [
        {
          content: { parts: [{ text: "The weather is sunny." }], role: "model" },
          finishReason: "STOP",
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    await provider.complete({
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_0", name: "get_weather", arguments: '{"city":"SF"}' },
          ],
        },
        {
          role: "tool",
          content: "Sunny in SF",
          name: "get_weather",
          toolCallId: "call_0",
        },
      ],
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    );

    // The tool message should be formatted as a user message with functionResponse
    const toolResponseMsg = body.contents.find(
      (c: { parts: Array<{ functionResponse?: unknown }> }) =>
        c.parts.some((p: { functionResponse?: unknown }) => p.functionResponse),
    );
    expect(toolResponseMsg).toBeDefined();
    expect(toolResponseMsg.role).toBe("user");
    expect(toolResponseMsg.parts[0].functionResponse.name).toBe("get_weather");
    expect(toolResponseMsg.parts[0].functionResponse.response.content).toBe(
      "Sunny in SF",
    );
  });

  it("does not include tools or systemInstruction when not provided", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const mockResponse = {
      candidates: [
        {
          content: { parts: [{ text: "Hello" }], role: "model" },
          finishReason: "STOP",
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    await provider.complete({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.systemInstruction).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gemini completeStream()
// ---------------------------------------------------------------------------

describe("Gemini completeStream()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("yields text deltas correctly", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const body = sseStream([
      `data: ${JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "Hello" }], role: "model" }, finishReason: "" },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        candidates: [
          { content: { parts: [{ text: " world" }], role: "model" }, finishReason: "" },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "!" }], role: "model" }, finishReason: "STOP" },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
      })}\n\n`,
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    const { deltas, result } = await collectStream(gen);

    expect(deltas).toEqual([
      { content: "Hello" },
      { content: " world" },
      { content: "!" },
    ]);

    const completion = result as CompletionResponse;
    expect(completion.message.content).toBe("Hello world!");
    expect(completion.finishReason).toBe("stop");
    expect(completion.usage?.promptTokens).toBe(5);
    expect(completion.usage?.completionTokens).toBe(3);
    expect(completion.usage?.totalTokens).toBe(8);
  });

  it("accumulates tool calls from stream chunks", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const body = sseStream([
      `data: ${JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: "get_weather", args: { city: "SF" } } },
              ],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 10, totalTokenCount: 18 },
      })}\n\n`,
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "weather?" }],
    });

    const { deltas, result } = await collectStream(gen);

    // No text deltas for tool calls
    expect(deltas).toHaveLength(0);

    const completion = result as CompletionResponse;
    expect(completion.finishReason).toBe("tool_calls");
    expect(completion.message.toolCalls).toHaveLength(1);
    expect(completion.message.toolCalls![0].id).toBe("call_0");
    expect(completion.message.toolCalls![0].name).toBe("get_weather");
    expect(completion.message.toolCalls![0].arguments).toBe('{"city":"SF"}');
  });

  it("uses streamGenerateContent endpoint with alt=sse", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const body = sseStream([
      `data: ${JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "Hi" }], role: "model" }, finishReason: "STOP" },
        ],
      })}\n\n`,
    ]);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    await collectStream(gen);

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=test-gemini-key-123",
    );
  });

  it("captures usage from non-candidate chunks", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const body = sseStream([
      `data: ${JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "Done" }], role: "model" }, finishReason: "STOP" },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
      })}\n\n`,
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    const { result } = await collectStream(gen);
    const completion = result as CompletionResponse;

    expect(completion.usage).toBeDefined();
    expect(completion.usage!.promptTokens).toBe(20);
    expect(completion.usage!.completionTokens).toBe(10);
    expect(completion.usage!.totalTokens).toBe(30);
  });

  it("throws when apiKeyEnvVar is not set on config (streaming)", async () => {
    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
    });

    const gen = provider.completeStream!({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(gen.next()).rejects.toThrow(/apiKeyEnvVar is required/);
  });

  it("throws when the API key env var is not populated (streaming)", async () => {
    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "MISSING_GEMINI_KEY_XYZ",
    });

    const gen = provider.completeStream!({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(gen.next()).rejects.toThrow(/API key not found/);
  });

  it("throws when response body is missing (streaming)", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    // Create a Response without a body
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "body", { value: null });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(gen.next()).rejects.toThrow(/No response body/);
  });

  it("maps MAX_TOKENS finish reason to length in streaming", async () => {
    vi.stubEnv("TEST_GEMINI_KEY", "test-gemini-key-123");

    const body = sseStream([
      `data: ${JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "Truncated" }], role: "model" }, finishReason: "MAX_TOKENS" },
        ],
      })}\n\n`,
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createGeminiProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKeyEnvVar: "TEST_GEMINI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "write a long essay" }],
    });

    const { result } = await collectStream(gen);
    const completion = result as CompletionResponse;
    expect(completion.finishReason).toBe("length");
  });
});

// ---------------------------------------------------------------------------
// formatGeminiMessages
// ---------------------------------------------------------------------------

describe("formatGeminiMessages", () => {
  it("extracts system messages into systemInstruction", () => {
    const result = formatGeminiMessages([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ]);

    expect(result.systemInstruction).toEqual({
      parts: [{ text: "You are helpful." }],
    });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].role).toBe("user");
  });

  it("returns undefined systemInstruction when no system messages", () => {
    const result = formatGeminiMessages([
      { role: "user", content: "Hi" },
    ]);

    expect(result.systemInstruction).toBeUndefined();
  });

  it("handles multiple system messages", () => {
    const result = formatGeminiMessages([
      { role: "system", content: "Rule 1" },
      { role: "system", content: "Rule 2" },
      { role: "user", content: "Hi" },
    ]);

    expect(result.systemInstruction).toEqual({
      parts: [{ text: "Rule 1" }, { text: "Rule 2" }],
    });
    expect(result.contents).toHaveLength(1);
  });

  it("formats user messages as user role with text parts", () => {
    const result = formatGeminiMessages([
      { role: "user", content: "Hello" },
    ]);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      role: "user",
      parts: [{ text: "Hello" }],
    });
  });

  it("formats assistant messages as model role", () => {
    const result = formatGeminiMessages([
      { role: "assistant", content: "Sure thing!" },
    ]);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      role: "model",
      parts: [{ text: "Sure thing!" }],
    });
  });

  it("formats assistant messages with tool calls as functionCall parts", () => {
    const result = formatGeminiMessages([
      {
        role: "assistant",
        content: "Let me check.",
        toolCalls: [
          { id: "call_0", name: "get_weather", arguments: '{"city":"NYC"}' },
        ],
      },
    ]);

    expect(result.contents).toHaveLength(1);
    const msg = result.contents[0];
    expect(msg.role).toBe("model");
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts[0]).toEqual({ text: "Let me check." });
    expect(msg.parts[1]).toEqual({
      functionCall: { name: "get_weather", args: { city: "NYC" } },
    });
  });

  it("formats tool messages as functionResponse parts", () => {
    const result = formatGeminiMessages([
      {
        role: "tool",
        content: "Sunny, 72F",
        name: "get_weather",
        toolCallId: "call_0",
      },
    ]);

    expect(result.contents).toHaveLength(1);
    const msg = result.contents[0];
    expect(msg.role).toBe("user");
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts[0]).toEqual({
      functionResponse: {
        name: "get_weather",
        response: { content: "Sunny, 72F" },
      },
    });
  });

  it("uses toolCallId as fallback name when name is missing on tool message", () => {
    const result = formatGeminiMessages([
      {
        role: "tool",
        content: "Result data",
        toolCallId: "call_123",
      },
    ]);

    expect(result.contents[0].parts[0]).toEqual({
      functionResponse: {
        name: "call_123",
        response: { content: "Result data" },
      },
    });
  });

  it("uses 'unknown' when both name and toolCallId are missing on tool message", () => {
    const result = formatGeminiMessages([
      { role: "tool", content: "Result data" },
    ]);

    expect(result.contents[0].parts[0]).toEqual({
      functionResponse: {
        name: "unknown",
        response: { content: "Result data" },
      },
    });
  });

  it("merges consecutive tool results into a single user message", () => {
    const result = formatGeminiMessages([
      {
        role: "tool",
        content: "Result 1",
        name: "tool_a",
        toolCallId: "call_0",
      },
      {
        role: "tool",
        content: "Result 2",
        name: "tool_b",
        toolCallId: "call_1",
      },
    ]);

    expect(result.contents).toHaveLength(1);
    const msg = result.contents[0];
    expect(msg.role).toBe("user");
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts[0]).toEqual({
      functionResponse: {
        name: "tool_a",
        response: { content: "Result 1" },
      },
    });
    expect(msg.parts[1]).toEqual({
      functionResponse: {
        name: "tool_b",
        response: { content: "Result 2" },
      },
    });
  });

  it("handles user messages with contentParts (multimodal)", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "",
        contentParts: [
          { type: "text", text: "What is in this image?" },
          {
            type: "image_url",
            image_url: { url: "https://example.com/cat.jpg" },
          },
        ],
      },
    ];

    const result = formatGeminiMessages(messages);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].parts).toHaveLength(2);
    expect(result.contents[0].parts[0]).toEqual({
      text: "What is in this image?",
    });
    expect(result.contents[0].parts[1]).toEqual({
      text: "[Image: https://example.com/cat.jpg]",
    });
  });

  it("handles a complete conversation flow", () => {
    const messages: Message[] = [
      { role: "system", content: "You are a weather assistant." },
      { role: "user", content: "What is the weather in SF?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_0", name: "get_weather", arguments: '{"city":"SF"}' },
        ],
      },
      {
        role: "tool",
        content: "Sunny, 72F",
        name: "get_weather",
        toolCallId: "call_0",
      },
      {
        role: "assistant",
        content: "The weather in SF is sunny and 72F.",
      },
    ];

    const result = formatGeminiMessages(messages);

    expect(result.systemInstruction).toEqual({
      parts: [{ text: "You are a weather assistant." }],
    });
    expect(result.contents).toHaveLength(4);
    expect(result.contents[0].role).toBe("user"); // user message
    expect(result.contents[1].role).toBe("model"); // assistant with tool call
    expect(result.contents[2].role).toBe("user"); // tool response
    expect(result.contents[3].role).toBe("model"); // final assistant response
  });

  it("skips assistant content part when content is empty", () => {
    const result = formatGeminiMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_0", name: "get_weather", arguments: '{"city":"SF"}' },
        ],
      },
    ]);

    expect(result.contents).toHaveLength(1);
    const msg = result.contents[0];
    expect(msg.role).toBe("model");
    // Should only have the functionCall part, no empty text part
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts[0]).toEqual({
      functionCall: { name: "get_weather", args: { city: "SF" } },
    });
  });
});
