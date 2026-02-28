import { describe, expect, it } from "vitest";
import {
  pruneToolResults,
  DEFAULT_CONTEXT_PRUNING_SETTINGS,
  type ContextPruningSettings,
} from "./context-pruning.js";
import type { Message } from "./types.js";

function makeToolMessage(contentLength: number, id = "t1"): Message {
  return {
    role: "tool",
    content: "x".repeat(contentLength),
    toolCallId: id,
  };
}

function makeConversation(toolContentLength: number): Message[] {
  return [
    { role: "user", content: "Hello" },
    {
      role: "assistant",
      content: "Let me check that.",
      toolCalls: [{ id: "t1", name: "web_fetch", arguments: "{}" }],
    },
    makeToolMessage(toolContentLength),
    { role: "assistant", content: "Here is the result." },
    { role: "user", content: "Tell me more" },
    { role: "assistant", content: "Sure, here is more info." },
    { role: "user", content: "Thanks" },
    { role: "assistant", content: "You're welcome!" },
  ];
}

const settings: ContextPruningSettings = {
  ...DEFAULT_CONTEXT_PRUNING_SETTINGS,
};

describe("pruneToolResults", () => {
  it("returns messages as-is when context ratio is below softTrimRatio", () => {
    const messages = makeConversation(100);
    // Large context window means low ratio
    const result = pruneToolResults(messages, settings, 1_000_000);
    expect(result).toBe(messages);
  });

  it("returns messages as-is when there are no tool messages", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];
    const result = pruneToolResults(messages, settings, 100);
    expect(result).toBe(messages);
  });

  it("returns messages as-is for empty array", () => {
    const result = pruneToolResults([], settings, 128_000);
    expect(result).toEqual([]);
  });

  it("soft-trims large tool results when ratio exceeds softTrimRatio", () => {
    // Create a tool result large enough to trigger soft trim
    // With 10k context window: charWindow = 40k
    // softTrimRatio = 0.3 → trigger when total > 12k chars
    const messages = makeConversation(20_000);
    const result = pruneToolResults(messages, settings, 10_000);

    // The tool message should be trimmed
    const toolMsg = result.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content.length).toBeLessThan(20_000);
    expect(toolMsg!.content).toContain("...");
    expect(toolMsg!.content).toContain("Tool result trimmed");
  });

  it("hard-clears tool results when ratio exceeds hardClearRatio", () => {
    // After soft-trim, tool result is ~3k chars. With 500 token context window
    // (2k char window), ratio stays above hardClearRatio (0.5) after soft-trim.
    const messages = makeConversation(100_000);
    const hardClearSettings: ContextPruningSettings = {
      ...settings,
      minPrunableToolChars: 100, // low threshold so hard-clear activates after soft-trim
    };
    const result = pruneToolResults(messages, hardClearSettings, 500);

    const toolMsg = result.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe("[Old tool result content cleared]");
  });

  it("does not prune messages before the first user message", () => {
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "assistant",
        content: "Reading config.",
        toolCalls: [{ id: "t0", name: "file_read", arguments: "{}" }],
      },
      { role: "tool", content: "x".repeat(50_000), toolCallId: "t0" },
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "Checking.",
        toolCalls: [{ id: "t1", name: "web_fetch", arguments: "{}" }],
      },
      { role: "tool", content: "y".repeat(50_000), toolCallId: "t1" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "More" },
      { role: "assistant", content: "More info." },
      { role: "user", content: "Thanks" },
      { role: "assistant", content: "Bye!" },
    ];

    const result = pruneToolResults(messages, settings, 5_000);

    // Bootstrap tool result (index 2, before first user) should be untouched
    expect(result[2].content).toBe("x".repeat(50_000));
    // Tool result after first user (index 5) should be pruned
    expect(result[5].content.length).toBeLessThan(50_000);
  });

  it("protects the last N assistant messages from pruning", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "Checking.",
        toolCalls: [{ id: "t1", name: "web_fetch", arguments: "{}" }],
      },
      { role: "tool", content: "a".repeat(50_000), toolCallId: "t1" },
      { role: "assistant", content: "First result." },
      { role: "user", content: "More" },
      {
        role: "assistant",
        content: "Let me look.",
        toolCalls: [{ id: "t2", name: "web_fetch", arguments: "{}" }],
      },
      { role: "tool", content: "b".repeat(50_000), toolCallId: "t2" },
      { role: "assistant", content: "Second result." }, // protected (3rd from end)
      { role: "user", content: "And more" },
      {
        role: "assistant",
        content: "Searching.",
        toolCalls: [{ id: "t3", name: "web_fetch", arguments: "{}" }],
      },
      { role: "tool", content: "c".repeat(50_000), toolCallId: "t3" },
      { role: "assistant", content: "Third result." }, // protected (2nd from end)
      { role: "user", content: "Thanks" },
      { role: "assistant", content: "Bye!" }, // protected (1st from end)
    ];

    // keepLastAssistants = 3 → the cutoff is at the 3rd-last assistant (index 7)
    // So tool at index 10 and 6 are in the protected zone, but tool at index 2 is prunable
    const result = pruneToolResults(messages, settings, 5_000);

    // Tool at index 2 is in prunable range (before 3rd-last assistant)
    expect(result[2].content.length).toBeLessThan(50_000);
  });

  it("skips hard-clear when prunableToolChars is below threshold", () => {
    // Tool results are small (below minPrunableToolChars = 50k)
    const messages = makeConversation(5_000);
    const customSettings: ContextPruningSettings = {
      ...settings,
      // Lower softTrimRatio so soft-trim triggers
      softTrimRatio: 0.01,
      hardClearRatio: 0.02,
    };

    const result = pruneToolResults(messages, customSettings, 1_000);
    const toolMsg = result.find((m) => m.role === "tool");
    // Should NOT be hard-cleared because total prunable tool chars < 50k
    expect(toolMsg!.content).not.toBe("[Old tool result content cleared]");
  });

  it("does not prune when hard-clear is disabled", () => {
    const messages = makeConversation(100_000);
    const customSettings: ContextPruningSettings = {
      ...settings,
      hardClear: { enabled: false, placeholder: "" },
    };

    const result = pruneToolResults(messages, customSettings, 4_000);
    const toolMsg = result.find((m) => m.role === "tool");
    // Should be soft-trimmed but not hard-cleared
    expect(toolMsg!.content).not.toBe("[Old tool result content cleared]");
    expect(toolMsg!.content).toContain("...");
  });

  it("returns original reference when no pruning is needed", () => {
    const messages = makeConversation(100);
    const result = pruneToolResults(messages, settings, 1_000_000);
    expect(result).toBe(messages); // same reference
  });

  it("handles zero contextWindowTokens", () => {
    const messages = makeConversation(1000);
    const result = pruneToolResults(messages, settings, 0);
    expect(result).toBe(messages);
  });
});
