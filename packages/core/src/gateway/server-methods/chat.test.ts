import { describe, it, expect, vi } from "vitest";
import { createChatSendHandler } from "./chat.js";
import type { AgentRuntime } from "../../agent/runtime.js";
import type { HistoryManager } from "../../sessions/history.js";
import { ZodError } from "zod";

function mockRuntime(overrides?: Partial<AgentRuntime>) {
  return {
    chat: vi.fn().mockResolvedValue({
      sessionId: "s1",
      message: { role: "assistant", content: "Hello!", timestamp: Date.now() },
      usage: { promptTokens: 10, completionTokens: 5 },
    }),
    ...overrides,
  } as unknown as AgentRuntime;
}

function mockHistory(overrides?: Partial<HistoryManager>) {
  return {
    getHistory: vi.fn().mockReturnValue([]),
    addMessages: vi.fn(),
    ...overrides,
  } as unknown as HistoryManager;
}

describe("chat.send handler", () => {
  it("returns response with correct sessionId on successful chat", async () => {
    const runtime = mockRuntime();
    const history = mockHistory();
    const handler = createChatSendHandler(runtime, history);

    const result = (await handler(
      { sessionId: "s1", message: "Hi" },
      "client-1",
    )) as { sessionId: string; message: unknown; usage: unknown };

    expect(result.sessionId).toBe("s1");
    expect(result.message).toEqual(
      expect.objectContaining({ role: "assistant", content: "Hello!" }),
    );
    expect(result.usage).toBeDefined();
  });

  it("throws ZodError when sessionId is missing", async () => {
    const runtime = mockRuntime();
    const history = mockHistory();
    const handler = createChatSendHandler(runtime, history);

    await expect(
      handler({ message: "Hi" }, "client-1"),
    ).rejects.toThrow(ZodError);
  });

  it("throws ZodError when message is missing", async () => {
    const runtime = mockRuntime();
    const history = mockHistory();
    const handler = createChatSendHandler(runtime, history);

    await expect(
      handler({ sessionId: "s1" }, "client-1"),
    ).rejects.toThrow(ZodError);
  });

  it("throws ZodError when sessionId is empty string", async () => {
    const runtime = mockRuntime();
    const history = mockHistory();
    const handler = createChatSendHandler(runtime, history);

    await expect(
      handler({ sessionId: "", message: "Hi" }, "client-1"),
    ).rejects.toThrow(ZodError);
  });

  it("propagates runtime.chat() errors", async () => {
    const runtime = mockRuntime({
      chat: vi.fn().mockRejectedValue(new Error("Provider down")),
    } as unknown as Partial<AgentRuntime>);
    const history = mockHistory();
    const handler = createChatSendHandler(runtime, history);

    await expect(
      handler({ sessionId: "s1", message: "Hi" }, "client-1"),
    ).rejects.toThrow("Provider down");
  });

  it("appends user message then assistant message to history", async () => {
    const addMessages = vi.fn();
    const runtime = mockRuntime();
    const history = mockHistory({ addMessages } as unknown as Partial<HistoryManager>);
    const handler = createChatSendHandler(runtime, history);

    await handler({ sessionId: "s1", message: "Hi" }, "client-1");

    expect(addMessages).toHaveBeenCalledOnce();
    const [sessionId, messages] = addMessages.mock.calls[0];
    expect(sessionId).toBe("s1");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hi");
    expect(messages[1].role).toBe("assistant");
  });
});
