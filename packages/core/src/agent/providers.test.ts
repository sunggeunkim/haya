import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "./providers.js";
import { ProviderHttpError, RetryableProviderError } from "./retry.js";

/**
 * Helper: builds a ReadableStream<Uint8Array> from an array of SSE-formatted strings.
 * Each string should be a complete SSE event line (e.g. 'data: {"foo":"bar"}\n\n').
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

describe("createProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates an OpenAI provider", () => {
    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "OPENAI_API_KEY",
    });
    expect(provider.name).toBe("openai");
  });

  it("creates an Anthropic provider", () => {
    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
    });
    expect(provider.name).toBe("anthropic");
  });

  it("creates a custom provider with baseUrl", () => {
    const provider = createProvider({
      provider: "custom-llm",
      model: "custom-model",
      apiKeyEnvVar: "CUSTOM_KEY",
      baseUrl: "https://custom-api.example.com/v1",
    });
    expect(provider.name).toBe("custom-llm");
  });

  it("throws for unknown provider without baseUrl", () => {
    expect(() =>
      createProvider({
        provider: "unknown",
        model: "model",
        apiKeyEnvVar: "KEY",
      }),
    ).toThrow(/Unknown provider/);
  });

  it("throws when API key env var is not set", async () => {
    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "NONEXISTENT_KEY_XYZ",
    });

    await expect(
      provider.complete({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key not found/);
  });
});

describe("OpenAI complete()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends correct request structure and parses response", async () => {
    vi.stubEnv("TEST_OPENAI_KEY", "sk-test-123");

    const mockResponse = {
      choices: [
        {
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "TEST_OPENAI_KEY",
    });

    const result = await provider.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "greet",
          description: "Greet someone",
          parameters: { type: "object" },
          execute: async () => "hello",
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test-123",
    );
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toBeDefined();
    expect(body.tools).toBeDefined();
    expect(body.tools[0].type).toBe("function");

    expect(result.message.content).toBe("Hello!");
    expect(result.finishReason).toBe("stop");
    expect(result.usage?.totalTokens).toBe(8);
  });

  it("maps tool_calls from the response correctly", async () => {
    vi.stubEnv("TEST_OPENAI_KEY", "sk-test-123");

    const mockResponse = {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"SF"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "TEST_OPENAI_KEY",
    });

    const result = await provider.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "weather?" }],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls).toHaveLength(1);
    expect(result.message.toolCalls![0].id).toBe("call_1");
    expect(result.message.toolCalls![0].name).toBe("get_weather");
    expect(result.message.toolCalls![0].arguments).toBe('{"city":"SF"}');
  });

  it("throws on non-retryable error response", async () => {
    vi.stubEnv("TEST_OPENAI_KEY", "sk-test-123");

    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => Promise.resolve(new Response("bad request", { status: 400 })),
    );

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "TEST_OPENAI_KEY",
      retryOptions: { maxRetries: 0 },
    });

    await expect(
      provider.complete({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(ProviderHttpError);
  });

  it("retries and throws on persistent retryable error", async () => {
    vi.stubEnv("TEST_OPENAI_KEY", "sk-test-123");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => Promise.resolve(new Response("rate limited", { status: 429 })),
    );

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "TEST_OPENAI_KEY",
      retryOptions: { maxRetries: 1, initialDelayMs: 10 },
    });

    await expect(
      provider.complete({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(RetryableProviderError);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});

describe("Anthropic complete()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends correct headers and extracts system messages", async () => {
    vi.stubEnv("TEST_ANTHROPIC_KEY", "sk-ant-test");

    const mockResponse = {
      content: [{ type: "text", text: "Hello from Claude!" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "TEST_ANTHROPIC_KEY",
    });

    const result = await provider.complete({
      model: "claude-opus-4-6",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
    });

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = options.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(options.body as string);
    expect(body.system).toBe("You are helpful.");
    // System messages should not appear in messages array
    expect(body.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);

    expect(result.message.content).toBe("Hello from Claude!");
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(5);
  });

  it("maps tool role messages to tool_result format", async () => {
    vi.stubEnv("TEST_ANTHROPIC_KEY", "sk-ant-test");

    const mockResponse = {
      content: [{ type: "text", text: "The weather is sunny." }],
      stop_reason: "end_turn",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "TEST_ANTHROPIC_KEY",
    });

    await provider.complete({
      model: "claude-opus-4-6",
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tu_1", name: "get_weather", arguments: '{"city":"SF"}' }],
        },
        { role: "tool", content: "Sunny in SF", toolCallId: "tu_1" },
      ],
    });

    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    // The tool message should be mapped to user role with tool_result content
    const toolResultMsg = body.messages.find(
      (m: { content: unknown }) => Array.isArray(m.content),
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.role).toBe("user");
    expect(toolResultMsg.content[0].type).toBe("tool_result");
    expect(toolResultMsg.content[0].tool_use_id).toBe("tu_1");
    expect(toolResultMsg.content[0].content).toBe("Sunny in SF");
  });

  it("throws on non-ok response with status code", async () => {
    vi.stubEnv("TEST_ANTHROPIC_KEY", "sk-ant-test");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("server error", { status: 500 }),
    );

    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "TEST_ANTHROPIC_KEY",
    });

    await expect(
      provider.complete({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/500/);
  });
});

// ---------------------------------------------------------------------------
// Streaming tests
// ---------------------------------------------------------------------------

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

describe("OpenAI completeStream()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("yields text deltas correctly", async () => {
    vi.stubEnv("TEST_OPENAI_KEY", "sk-test-123");

    const body = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " world" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "TEST_OPENAI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });

    const { deltas, result } = await collectStream(gen);

    // Should yield two text deltas
    expect(deltas).toEqual([{ content: "Hello" }, { content: " world" }]);

    // Final assembled message
    const completion = result as { message: { content: string }; finishReason: string };
    expect(completion.message.content).toBe("Hello world");
    expect(completion.finishReason).toBe("stop");
  });

  it("accumulates tool calls from stream chunks", async () => {
    vi.stubEnv("TEST_OPENAI_KEY", "sk-test-123");

    const body = sseStream([
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{ index: 0, id: "call_abc", function: { name: "get_weather", arguments: "" } }],
          },
          finish_reason: null,
        }],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"city"' } }],
          },
          finish_reason: null,
        }],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{ index: 0, function: { arguments: ':"SF"}' } }],
          },
          finish_reason: null,
        }],
      })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "TEST_OPENAI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gpt-4o",
      messages: [{ role: "user", content: "weather?" }],
    });

    const { result } = await collectStream(gen);
    const completion = result as {
      message: { toolCalls?: Array<{ id: string; name: string; arguments: string }> };
      finishReason: string;
    };

    expect(completion.finishReason).toBe("tool_calls");
    expect(completion.message.toolCalls).toHaveLength(1);
    expect(completion.message.toolCalls![0].id).toBe("call_abc");
    expect(completion.message.toolCalls![0].name).toBe("get_weather");
    expect(completion.message.toolCalls![0].arguments).toBe('{"city":"SF"}');
  });

  it("captures usage from the final chunk", async () => {
    vi.stubEnv("TEST_OPENAI_KEY", "sk-test-123");

    const body = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "TEST_OPENAI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });

    const { result } = await collectStream(gen);
    const completion = result as {
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

    expect(completion.usage).toBeDefined();
    expect(completion.usage!.promptTokens).toBe(10);
    expect(completion.usage!.completionTokens).toBe(5);
    expect(completion.usage!.totalTokens).toBe(15);
  });

  it("sets finish reason correctly for each reason type", async () => {
    vi.stubEnv("TEST_OPENAI_KEY", "sk-test-123");

    // Test "length" finish reason
    const body = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "truncated" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "TEST_OPENAI_KEY",
    });

    const gen = provider.completeStream!({
      model: "gpt-4o",
      messages: [{ role: "user", content: "write a long essay" }],
    });

    const { result } = await collectStream(gen);
    const completion = result as { finishReason: string };
    expect(completion.finishReason).toBe("length");
  });
});

describe("Anthropic completeStream()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("yields text deltas from content_block_delta events", async () => {
    vi.stubEnv("TEST_ANTHROPIC_KEY", "sk-ant-test");

    const body = sseStream([
      `data: ${JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 8, output_tokens: 1 } },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_start",
        content_block: { type: "text" },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: " from Claude" },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 6 },
      })}\n\n`,
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "TEST_ANTHROPIC_KEY",
    });

    const gen = provider.completeStream!({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hi" }],
    });

    const { deltas, result } = await collectStream(gen);

    expect(deltas).toEqual([{ content: "Hello" }, { content: " from Claude" }]);

    const completion = result as { message: { content: string }; finishReason: string };
    expect(completion.message.content).toBe("Hello from Claude");
    expect(completion.finishReason).toBe("stop");
  });

  it("accumulates tool use blocks from stream", async () => {
    vi.stubEnv("TEST_ANTHROPIC_KEY", "sk-ant-test");

    const body = sseStream([
      `data: ${JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 12, output_tokens: 1 } },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_start",
        content_block: { type: "tool_use", id: "tu_123", name: "get_weather" },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"city"' },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: ':"SF"}' },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 20 },
      })}\n\n`,
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "TEST_ANTHROPIC_KEY",
    });

    const gen = provider.completeStream!({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "weather?" }],
    });

    const { deltas, result } = await collectStream(gen);

    // No text deltas should be yielded for pure tool use
    expect(deltas).toHaveLength(0);

    const completion = result as {
      message: { toolCalls?: Array<{ id: string; name: string; arguments: string }> };
      finishReason: string;
    };

    expect(completion.finishReason).toBe("tool_calls");
    expect(completion.message.toolCalls).toHaveLength(1);
    expect(completion.message.toolCalls![0].id).toBe("tu_123");
    expect(completion.message.toolCalls![0].name).toBe("get_weather");
    expect(completion.message.toolCalls![0].arguments).toBe('{"city":"SF"}');
  });

  it("extracts system messages in streaming mode too", async () => {
    vi.stubEnv("TEST_ANTHROPIC_KEY", "sk-ant-test");

    const body = sseStream([
      `data: ${JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 15, output_tokens: 1 } },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "I am helpful." },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 4 },
      })}\n\n`,
    ]);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "TEST_ANTHROPIC_KEY",
    });

    const gen = provider.completeStream!({
      model: "claude-opus-4-6",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
    });

    await collectStream(gen);

    // Verify the request body sent to the API has system extracted
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const reqBody = JSON.parse(options.body as string);
    expect(reqBody.system).toBe("You are helpful.");
    expect(reqBody.stream).toBe(true);
    // System messages should NOT appear in the messages array
    expect(
      reqBody.messages.every((m: { role: string }) => m.role !== "system"),
    ).toBe(true);
  });

  it("captures usage from message_start and message_delta events", async () => {
    vi.stubEnv("TEST_ANTHROPIC_KEY", "sk-ant-test");

    const body = sseStream([
      `data: ${JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 20, output_tokens: 1 } },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Done" },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 10 },
      })}\n\n`,
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "TEST_ANTHROPIC_KEY",
    });

    const gen = provider.completeStream!({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hi" }],
    });

    const { result } = await collectStream(gen);
    const completion = result as {
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

    // message_start sets initial usage, message_delta updates output tokens
    expect(completion.usage).toBeDefined();
    expect(completion.usage!.promptTokens).toBe(20);
    expect(completion.usage!.completionTokens).toBe(10);
    expect(completion.usage!.totalTokens).toBe(30);
  });
});
