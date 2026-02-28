import { describe, expect, it } from "vitest";
import {
  shouldRunMemoryFlush,
  estimateSessionTokens,
  buildMemoryFlushMessages,
  DEFAULT_MEMORY_FLUSH_PROMPT,
  DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT,
  type MemoryFlushParams,
} from "./memory-flush.js";
import { createSimpleTokenCounter } from "./token-counter.js";
import type { Message } from "./types.js";

const counter = createSimpleTokenCounter();

describe("shouldRunMemoryFlush", () => {
  const baseParams: MemoryFlushParams = {
    totalTokens: 100_000,
    contextWindowTokens: 128_000,
    reserveTokens: 4096,
    softThresholdTokens: 4000,
    hasRunForCycle: false,
  };

  it("returns true when approaching context limit", () => {
    // threshold = 128000 - 4096 - 4000 = 119904
    // totalTokens = 120000 >= 119904
    expect(
      shouldRunMemoryFlush({ ...baseParams, totalTokens: 120_000 }),
    ).toBe(true);
  });

  it("returns false when well below threshold", () => {
    expect(
      shouldRunMemoryFlush({ ...baseParams, totalTokens: 50_000 }),
    ).toBe(false);
  });

  it("returns false when already run for this cycle", () => {
    expect(
      shouldRunMemoryFlush({
        ...baseParams,
        totalTokens: 120_000,
        hasRunForCycle: true,
      }),
    ).toBe(false);
  });

  it("returns false when totalTokens is zero", () => {
    expect(
      shouldRunMemoryFlush({ ...baseParams, totalTokens: 0 }),
    ).toBe(false);
  });

  it("returns false when threshold is non-positive", () => {
    // contextWindow < reserveTokens + softThreshold
    expect(
      shouldRunMemoryFlush({
        ...baseParams,
        contextWindowTokens: 1000,
        reserveTokens: 2000,
        softThresholdTokens: 2000,
      }),
    ).toBe(false);
  });

  it("returns true at exactly the threshold", () => {
    // threshold = 128000 - 4096 - 4000 = 119904
    expect(
      shouldRunMemoryFlush({ ...baseParams, totalTokens: 119_904 }),
    ).toBe(true);
  });

  it("returns false just below threshold", () => {
    expect(
      shouldRunMemoryFlush({ ...baseParams, totalTokens: 119_903 }),
    ).toBe(false);
  });
});

describe("estimateSessionTokens", () => {
  it("counts tokens for messages", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello world" }, // 11 chars → 3 tokens + 4 overhead
      { role: "assistant", content: "Hi!" }, // 3 chars → 1 token + 4 overhead
    ];
    const tokens = estimateSessionTokens(messages, counter);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(counter.countMessages(messages));
  });

  it("returns 0 for empty messages", () => {
    expect(estimateSessionTokens([], counter)).toBe(0);
  });
});

describe("buildMemoryFlushMessages", () => {
  it("uses default prompts when none provided", () => {
    const messages = buildMemoryFlushMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT);
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe(DEFAULT_MEMORY_FLUSH_PROMPT);
  });

  it("uses custom prompts when provided", () => {
    const messages = buildMemoryFlushMessages("Custom system", "Custom user");
    expect(messages[0].content).toBe("Custom system");
    expect(messages[1].content).toBe("Custom user");
  });
});
