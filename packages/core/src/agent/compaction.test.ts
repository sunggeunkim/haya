import { describe, expect, it } from "vitest";
import { compactHistory, type CompactionOptions } from "./compaction.js";
import { createSimpleTokenCounter } from "./token-counter.js";
import type { Message } from "./types.js";

const counter = createSimpleTokenCounter();

function makeMessages(count: number, contentLength: number = 100): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: "user" as const,
    content: `Message ${i}: ${"x".repeat(contentLength)}`,
  }));
}

describe("compactHistory", () => {
  it("returns messages as-is when they fit the budget", () => {
    const messages: Message[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    const options: CompactionOptions = {
      maxTokens: 10000,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 10,
    };

    const result = compactHistory(messages, options, counter);
    expect(result).toEqual(messages);
  });

  it("compacts history when it exceeds the budget", () => {
    // Create many messages that exceed the budget
    const messages = makeMessages(50, 200);
    const totalTokens = counter.countMessages(messages);

    const options: CompactionOptions = {
      maxTokens: Math.floor(totalTokens / 2) + 4096 + 100,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 10,
    };

    const result = compactHistory(messages, options, counter);

    // Should have fewer messages than the original
    expect(result.length).toBeLessThan(messages.length);
    // Should fit in budget now
    const resultTokens = counter.countMessages(result);
    const budget = options.maxTokens - options.reserveForResponse - options.systemPromptTokens;
    expect(resultTokens).toBeLessThanOrEqual(budget);
  });

  it("adds truncation marker when messages are dropped", () => {
    const messages = makeMessages(50, 200);
    const totalTokens = counter.countMessages(messages);

    const options: CompactionOptions = {
      maxTokens: Math.floor(totalTokens / 2) + 4096 + 100,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 10,
    };

    const result = compactHistory(messages, options, counter);

    // First message should be the truncation marker
    expect(result[0]?.role).toBe("system");
    expect(result[0]?.content).toContain(
      "Earlier conversation history was truncated",
    );
  });

  it("preserves the most recent messages", () => {
    const messages = makeMessages(20, 200);
    const totalTokens = counter.countMessages(messages);

    const options: CompactionOptions = {
      maxTokens: Math.floor(totalTokens / 3) + 4096 + 100,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 5,
    };

    const result = compactHistory(messages, options, counter);

    // The last 5 messages from the original should be at the end
    const lastFiveOriginal = messages.slice(-5);
    const lastFiveResult = result.slice(-5);
    expect(lastFiveResult).toEqual(lastFiveOriginal);
  });

  it("handles empty message array", () => {
    const options: CompactionOptions = {
      maxTokens: 10000,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 10,
    };

    const result = compactHistory([], options, counter);
    expect(result).toEqual([]);
  });

  it("handles single message", () => {
    const messages: Message[] = [{ role: "user", content: "Hello" }];
    const options: CompactionOptions = {
      maxTokens: 10000,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 10,
    };

    const result = compactHistory(messages, options, counter);
    expect(result).toEqual(messages);
  });

  it("returns only recent messages when all older ones must be dropped", () => {
    const messages = makeMessages(20, 200);

    // Tiny budget — only enough for the recent messages (plus some overhead)
    const recentCount = 5;
    const recentMessages = messages.slice(-recentCount);
    const recentTokens = counter.countMessages(recentMessages);

    const options: CompactionOptions = {
      maxTokens: recentTokens + 4096 + 100 + 20, // just enough for recent + marker
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: recentCount,
    };

    const result = compactHistory(messages, options, counter);

    // Should have marker + recent messages
    expect(result[0]?.role).toBe("system");
    expect(result[0]?.content).toContain("truncated");
    expect(result.slice(1)).toEqual(recentMessages);
  });

  it("does not add marker when no messages are dropped", () => {
    const messages: Message[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    const options: CompactionOptions = {
      maxTokens: 10000,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 10,
    };

    const result = compactHistory(messages, options, counter);
    expect(result).toEqual(messages);
    // No system truncation marker
    expect(result.some((m) => m.content.includes("truncated"))).toBe(false);
  });

  it("handles case where all messages are in the recent window", () => {
    const messages = makeMessages(5, 200);
    const totalTokens = counter.countMessages(messages);

    const options: CompactionOptions = {
      maxTokens: totalTokens + 4096 + 100,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 10, // bigger than message count
    };

    const result = compactHistory(messages, options, counter);
    expect(result).toEqual(messages);
  });

  it("handles very small budget by returning recent messages", () => {
    const messages = makeMessages(10, 200);

    const options: CompactionOptions = {
      maxTokens: 100,
      reserveForResponse: 4096,
      systemPromptTokens: 100,
      recentMessageCount: 3,
    };

    // Budget is negative after subtracting reserves, so returns recent slice
    const result = compactHistory(messages, options, counter);
    expect(result).toEqual(messages.slice(-3));
  });
});
