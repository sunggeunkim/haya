import { describe, expect, it, vi } from "vitest";
import {
  summarizeMessages,
  chunkMessagesByMaxTokens,
} from "./summarizer.js";
import { createSimpleTokenCounter } from "./token-counter.js";
import type { Message } from "./types.js";

const counter = createSimpleTokenCounter();

function makeMessages(count: number, contentLength: number = 100): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
    content: `Message ${i}: ${"x".repeat(contentLength)}`,
  }));
}

describe("chunkMessagesByMaxTokens", () => {
  it("returns empty array for no messages", () => {
    expect(chunkMessagesByMaxTokens([], 1000, counter)).toEqual([]);
  });

  it("keeps all messages in one chunk when they fit", () => {
    const messages = makeMessages(3, 50);
    const chunks = chunkMessagesByMaxTokens(messages, 10000, counter);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(messages);
  });

  it("splits messages into multiple chunks when they exceed budget", () => {
    const messages = makeMessages(10, 200);
    // Each message is about 55 tokens (212 chars / 4 + 4 overhead)
    const chunks = chunkMessagesByMaxTokens(messages, 200, counter);
    expect(chunks.length).toBeGreaterThan(1);

    // All messages should be present across chunks
    const allMessages = chunks.flat();
    expect(allMessages).toHaveLength(10);
  });

  it("handles single oversized message", () => {
    const messages: Message[] = [
      { role: "user", content: "x".repeat(10000) },
    ];
    const chunks = chunkMessagesByMaxTokens(messages, 100, counter);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(messages);
  });
});

describe("summarizeMessages", () => {
  it("returns fallback for empty messages", async () => {
    const complete = vi.fn();
    const result = await summarizeMessages([], { complete }, counter);
    expect(result).toContain("summarized");
    expect(complete).not.toHaveBeenCalled();
  });

  it("calls complete with summarization prompt", async () => {
    const complete = vi.fn().mockResolvedValue("Summary of the conversation.");
    const messages = makeMessages(3, 50);

    const result = await summarizeMessages(messages, { complete }, counter);

    expect(result).toBe("Summary of the conversation.");
    expect(complete).toHaveBeenCalledOnce();

    const promptMessages = complete.mock.calls[0][0] as Message[];
    expect(promptMessages[0].role).toBe("system");
    expect(promptMessages[0].content).toContain("summarizer");
    expect(promptMessages[1].role).toBe("user");
    expect(promptMessages[1].content).toContain("Message 0");
  });

  it("truncates long tool results in summary input", async () => {
    const complete = vi.fn().mockResolvedValue("Summary.");
    const messages: Message[] = [
      { role: "user", content: "Check this" },
      { role: "tool", content: "x".repeat(5000), toolCallId: "t1" },
      { role: "assistant", content: "Done." },
    ];

    await summarizeMessages(messages, { complete }, counter);

    const promptMessages = complete.mock.calls[0][0] as Message[];
    const input = promptMessages[1].content;
    // Tool result should be truncated to 2000 chars + "..."
    expect(input).toContain("...");
    expect(input.length).toBeLessThan(5000);
  });

  it("falls back to truncation marker on error", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("API error"));
    const messages = makeMessages(3, 50);

    const result = await summarizeMessages(messages, { complete }, counter);

    expect(result).toContain("summarized");
    expect(result).toContain("3 messages dropped");
  });

  it("merges summaries for large conversations", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("Part 1 summary.")
      .mockResolvedValueOnce("Part 2 summary.")
      .mockResolvedValueOnce("Merged summary.");

    // Create enough messages to require chunking with reserveTokens=500
    // maxChunkTokens = max(1000, 500*4) = 2000
    // Each message ≈ 132 tokens → 20 messages ≈ 2640 tokens → 2 chunks
    // 2 chunk summaries + 1 merge = 3 calls (matches mock)
    const messages = makeMessages(20, 500);

    const result = await summarizeMessages(
      messages,
      { complete, reserveTokens: 500 },
      counter,
    );

    expect(result).toBe("Merged summary.");
    // Should have called: chunk1 summary + chunk2 summary + merge
    expect(complete).toHaveBeenCalledTimes(3);
  });
});
