import { describe, expect, it } from "vitest";
import type { AIProvider } from "./providers.js";
import { AgentRuntime } from "./runtime.js";
import { ToolRegistry } from "./tools.js";
import type {
  ChatChunkEvent,
  CompletionRequest,
  CompletionResponse,
  Message,
  StreamDelta,
} from "./types.js";

function mockProvider(responses: CompletionResponse[]): AIProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async complete(_request: CompletionRequest): Promise<CompletionResponse> {
      const response = responses[callIndex];
      if (!response) {
        throw new Error(`No more mock responses (call ${callIndex})`);
      }
      callIndex++;
      return response;
    },
  };
}

describe("AgentRuntime", () => {
  it("processes a simple chat message", async () => {
    const provider = mockProvider([
      {
        message: { role: "assistant", content: "Hello, human!" },
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    ]);

    const runtime = new AgentRuntime(provider, {
      defaultModel: "test-model",
    });

    const response = await runtime.chat(
      { sessionId: "s1", message: "Hi there" },
      [],
    );

    expect(response.sessionId).toBe("s1");
    expect(response.message.role).toBe("assistant");
    expect(response.message.content).toBe("Hello, human!");
    expect(response.usage?.totalTokens).toBe(15);
  });

  it("includes system prompt when configured", async () => {
    let capturedMessages: Message[] = [];
    const provider: AIProvider = {
      name: "mock",
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        capturedMessages = request.messages;
        return {
          message: { role: "assistant", content: "OK" },
          finishReason: "stop",
        };
      },
    };

    const runtime = new AgentRuntime(provider, {
      defaultModel: "test",
      systemPrompt: "You are a helpful assistant.",
    });

    await runtime.chat({ sessionId: "s1", message: "Hi" }, []);

    expect(capturedMessages[0]?.role).toBe("system");
    expect(capturedMessages[0]?.content).toBe("You are a helpful assistant.");
  });

  it("includes conversation history", async () => {
    let capturedMessageCount = 0;
    let capturedContents: string[] = [];
    const provider: AIProvider = {
      name: "mock",
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        capturedMessageCount = request.messages.length;
        capturedContents = request.messages.map((m) => m.content);
        return {
          message: { role: "assistant", content: "Response" },
          finishReason: "stop",
        };
      },
    };

    const runtime = new AgentRuntime(provider, { defaultModel: "test" });
    const history: Message[] = [
      { role: "user", content: "First message" },
      { role: "assistant", content: "First response" },
    ];

    await runtime.chat({ sessionId: "s1", message: "Second message" }, history);

    expect(capturedMessageCount).toBe(3); // history[0] + history[1] + new user
    expect(capturedContents[0]).toBe("First message");
    expect(capturedContents[1]).toBe("First response");
    expect(capturedContents[2]).toBe("Second message");
  });

  it("handles tool call loop", async () => {
    const provider = mockProvider([
      // First response: AI wants to call a tool
      {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "tc-1", name: "get_weather", arguments: '{"city":"SF"}' },
          ],
        },
        finishReason: "tool_calls",
      },
      // Second response: AI generates final answer using tool result
      {
        message: { role: "assistant", content: "The weather in SF is sunny." },
        finishReason: "stop",
      },
    ]);

    const tools = new ToolRegistry();
    tools.register({
      name: "get_weather",
      description: "Get weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
      execute: async (args) => `Sunny in ${(args as Record<string, string>).city}`,
    });

    const runtime = new AgentRuntime(provider, { defaultModel: "test" }, { tools });

    const response = await runtime.chat(
      { sessionId: "s1", message: "What's the weather in SF?" },
      [],
    );

    expect(response.message.content).toBe("The weather in SF is sunny.");
  });

  it("respects max tool rounds", async () => {
    // Provider always asks for tool calls
    const provider: AIProvider = {
      name: "mock",
      async complete(): Promise<CompletionResponse> {
        return {
          message: {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "tc-1", name: "loop_tool", arguments: "{}" },
            ],
          },
          finishReason: "tool_calls",
        };
      },
    };

    const tools = new ToolRegistry();
    tools.register({
      name: "loop_tool",
      description: "Loops forever",
      parameters: {},
      execute: async () => "again",
    });

    const runtime = new AgentRuntime(
      provider,
      { defaultModel: "test", maxToolRounds: 3 },
      { tools },
    );

    const response = await runtime.chat(
      { sessionId: "s1", message: "Do something" },
      [],
    );

    // Should hit the max rounds fallback
    expect(response.message.content).toContain("unable to complete");
  });

  it("overrides model from chat request", async () => {
    let capturedModel = "";
    const provider: AIProvider = {
      name: "mock",
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        capturedModel = request.model;
        return {
          message: { role: "assistant", content: "OK" },
          finishReason: "stop",
        };
      },
    };

    const runtime = new AgentRuntime(provider, {
      defaultModel: "default-model",
    });

    await runtime.chat(
      { sessionId: "s1", message: "Hi", model: "override-model" },
      [],
    );

    expect(capturedModel).toBe("override-model");
  });

  it("calls stream callback with final content", async () => {
    const provider = mockProvider([
      {
        message: { role: "assistant", content: "Streamed response" },
        finishReason: "stop",
      },
    ]);

    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    const chunks: string[] = [];
    await runtime.chat(
      { sessionId: "s1", message: "Hi" },
      [],
      (chunk) => {
        chunks.push(chunk.delta);
      },
    );

    expect(chunks).toEqual(["Streamed response"]);
  });

  it("stream callback fires even when content is empty string", async () => {
    const provider = mockProvider([
      {
        message: { role: "assistant", content: "" },
        finishReason: "stop",
      },
    ]);

    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    const events: { delta: string; done: boolean }[] = [];
    await runtime.chat(
      { sessionId: "s1", message: "Hi" },
      [],
      (chunk) => {
        events.push({ delta: chunk.delta, done: chunk.done });
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0].done).toBe(true);
    expect(events[0].delta).toBe("");
  });

  it("per-request systemPrompt override", async () => {
    let capturedMessages: Message[] = [];
    const provider: AIProvider = {
      name: "mock",
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        capturedMessages = request.messages;
        return {
          message: { role: "assistant", content: "OK" },
          finishReason: "stop",
        };
      },
    };

    const runtime = new AgentRuntime(provider, {
      defaultModel: "test",
      systemPrompt: "Default system prompt",
    });

    await runtime.chat(
      { sessionId: "s1", message: "Hi", systemPrompt: "Override prompt" },
      [],
    );

    expect(capturedMessages[0]?.role).toBe("system");
    expect(capturedMessages[0]?.content).toBe("Override prompt");
  });

  it("provider error propagation", async () => {
    const provider: AIProvider = {
      name: "mock",
      async complete(): Promise<CompletionResponse> {
        throw new Error("Provider unavailable");
      },
    };

    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    await expect(
      runtime.chat({ sessionId: "s1", message: "Hi" }, []),
    ).rejects.toThrow("Provider unavailable");
  });

  it("finishReason=tool_calls with empty toolCalls falls through", async () => {
    const provider = mockProvider([
      {
        message: { role: "assistant", content: "No tools actually needed" },
        finishReason: "tool_calls",
        // toolCalls is undefined / empty
      },
    ]);

    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    const response = await runtime.chat(
      { sessionId: "s1", message: "Hi" },
      [],
    );

    // Should return a response instead of looping, since toolCalls is empty
    expect(response.message.content).toBe("No tools actually needed");
  });

  it("rejects when budget enforcer throws", async () => {
    const provider = mockProvider([
      {
        message: { role: "assistant", content: "OK" },
        finishReason: "stop",
      },
    ]);

    const budgetEnforcer = {
      enforce(_sessionId: string): void {
        throw new Error("Budget exceeded");
      },
    };

    const runtime = new AgentRuntime(
      provider,
      { defaultModel: "test" },
      { budgetEnforcer: budgetEnforcer as import("../sessions/budget.js").BudgetEnforcer },
    );

    await expect(
      runtime.chat({ sessionId: "s1", message: "Hi" }, []),
    ).rejects.toThrow("Budget exceeded");
  });

  it("uses completeStream() when onChunk callback is provided and provider supports it", async () => {
    let completeStreamCalled = false;
    let completeCalled = false;

    async function* mockStream(): AsyncGenerator<StreamDelta, CompletionResponse> {
      yield { content: "chunk1" };
      yield { content: "chunk2" };
      return {
        message: { role: "assistant" as const, content: "chunk1chunk2" },
        finishReason: "stop" as const,
      };
    }

    const provider: AIProvider = {
      name: "mock-stream",
      async complete(_request: CompletionRequest): Promise<CompletionResponse> {
        completeCalled = true;
        return {
          message: { role: "assistant", content: "non-stream" },
          finishReason: "stop",
        };
      },
      completeStream(_request: CompletionRequest): AsyncGenerator<StreamDelta, CompletionResponse> {
        completeStreamCalled = true;
        return mockStream();
      },
    };

    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    const events: ChatChunkEvent[] = [];
    const response = await runtime.chat(
      { sessionId: "s1", message: "Hi" },
      [],
      (chunk) => {
        events.push({ ...chunk });
      },
    );

    expect(completeStreamCalled).toBe(true);
    expect(completeCalled).toBe(false);

    // Should have received two stream deltas plus the final done event
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ sessionId: "s1", delta: "chunk1", done: false });
    expect(events[1]).toEqual({ sessionId: "s1", delta: "chunk2", done: false });
    expect(events[2]).toEqual({ sessionId: "s1", delta: "chunk1chunk2", done: true });

    expect(response.message.content).toBe("chunk1chunk2");
  });

  it("streaming works through tool-call loop", async () => {
    let callCount = 0;
    let toolExecuted = false;

    async function* toolCallStream(): AsyncGenerator<StreamDelta, CompletionResponse> {
      yield { content: "" };
      return {
        message: {
          role: "assistant" as const,
          content: "",
          toolCalls: [
            { id: "tc-1", name: "echo_tool", arguments: '{"text":"hello"}' },
          ],
        },
        finishReason: "tool_calls" as const,
      };
    }

    async function* finalStream(): AsyncGenerator<StreamDelta, CompletionResponse> {
      yield { content: "final " };
      yield { content: "answer" };
      return {
        message: { role: "assistant" as const, content: "final answer" },
        finishReason: "stop" as const,
      };
    }

    const provider: AIProvider = {
      name: "mock-stream-tools",
      async complete(): Promise<CompletionResponse> {
        throw new Error("complete() should not be called");
      },
      completeStream(_request: CompletionRequest): AsyncGenerator<StreamDelta, CompletionResponse> {
        callCount++;
        if (callCount === 1) {
          return toolCallStream();
        }
        return finalStream();
      },
    };

    const tools = new ToolRegistry();
    tools.register({
      name: "echo_tool",
      description: "Echoes text",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      execute: async (args) => {
        toolExecuted = true;
        return `Echo: ${(args as Record<string, string>).text}`;
      },
    });

    const runtime = new AgentRuntime(provider, { defaultModel: "test" }, { tools });

    const events: ChatChunkEvent[] = [];
    const response = await runtime.chat(
      { sessionId: "s1", message: "Echo something" },
      [],
      (chunk) => {
        events.push({ ...chunk });
      },
    );

    expect(toolExecuted).toBe(true);
    expect(response.message.content).toBe("final answer");

    // The final stream yields "final " and "answer", plus the done event
    const contentEvents = events.filter((e) => !e.done && e.delta);
    expect(contentEvents).toHaveLength(2);
    expect(contentEvents[0].delta).toBe("final ");
    expect(contentEvents[1].delta).toBe("answer");

    const doneEvent = events.find((e) => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.delta).toBe("final answer");
  });

  it("updateSystemPrompt() changes prompt for subsequent calls", async () => {
    let capturedMessages: Message[] = [];
    const provider: AIProvider = {
      name: "mock",
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        capturedMessages = request.messages;
        return {
          message: { role: "assistant", content: "OK" },
          finishReason: "stop",
        };
      },
    };

    const runtime = new AgentRuntime(provider, {
      defaultModel: "test",
      systemPrompt: "Original",
    });

    runtime.updateSystemPrompt("Updated");

    await runtime.chat({ sessionId: "s1", message: "Hi" }, []);

    expect(capturedMessages[0]?.role).toBe("system");
    expect(capturedMessages[0]?.content).toBe("Updated");
  });
});
