/**
 * Pre-compaction memory flush.
 *
 * Before the context window reaches its limit and compaction kicks in,
 * this module triggers a silent agent turn that allows the assistant to
 * persist important durable memories to disk. This prevents information
 * loss during compaction.
 */

import type { TokenCounter } from "./token-counter.js";
import type { Message } from "./types.js";

export const DEFAULT_MEMORY_FLUSH_PROMPT =
  "Pre-compaction memory flush. The session is approaching context limits. " +
  "If there are important facts, decisions, or context worth remembering " +
  "long-term, use the save_memory tool to persist them now. " +
  "If nothing needs saving, reply with a brief acknowledgment.";

export const DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT =
  "Pre-compaction memory flush turn. The session is near auto-compaction; " +
  "capture durable memories to disk. Keep your response minimal.";

export interface MemoryFlushSettings {
  enabled: boolean;
  softThresholdTokens: number;
}

export interface MemoryFlushParams {
  /** Current total token count for the session's messages. */
  totalTokens: number;
  /** Context window size in tokens. */
  contextWindowTokens: number;
  /** Reserve tokens for response generation. */
  reserveTokens: number;
  /** Soft threshold tokens before compaction to trigger flush. */
  softThresholdTokens: number;
  /** Whether memory flush has already run for this compaction cycle. */
  hasRunForCycle: boolean;
}

/**
 * Determine whether a memory flush should run before compaction.
 *
 * The flush triggers when:
 * 1. Total tokens >= (contextWindow - reserveTokens - softThreshold)
 * 2. The flush hasn't already run for the current compaction cycle
 */
export function shouldRunMemoryFlush(params: MemoryFlushParams): boolean {
  if (params.totalTokens <= 0 || params.hasRunForCycle) return false;

  const contextWindow = Math.max(1, Math.floor(params.contextWindowTokens));
  const reserveTokens = Math.max(0, Math.floor(params.reserveTokens));
  const softThreshold = Math.max(0, Math.floor(params.softThresholdTokens));
  const threshold = Math.max(0, contextWindow - reserveTokens - softThreshold);

  if (threshold <= 0) return false;

  return params.totalTokens >= threshold;
}

/**
 * Estimate the total token count for a set of messages.
 */
export function estimateSessionTokens(
  messages: Message[],
  counter: TokenCounter,
): number {
  return counter.countMessages(messages);
}

/**
 * Build the memory flush prompt messages.
 */
export function buildMemoryFlushMessages(
  systemPrompt?: string,
  userPrompt?: string,
): Message[] {
  return [
    {
      role: "system",
      content: systemPrompt ?? DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: userPrompt ?? DEFAULT_MEMORY_FLUSH_PROMPT,
    },
  ];
}
