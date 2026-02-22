/**
 * Token-aware context compaction for conversation history.
 * Drops oldest messages until the history fits within a token budget,
 * while preserving the most recent messages.
 */

import type { TokenCounter } from "./token-counter.js";
import type { Message } from "./types.js";

export interface CompactionOptions {
  maxTokens: number;
  reserveForResponse: number;
  systemPromptTokens: number;
  recentMessageCount: number;
}

const TRUNCATION_MARKER =
  "[Earlier conversation history was truncated to fit context limits]";

const DEFAULT_RESERVE_FOR_RESPONSE = 4096;
const DEFAULT_RECENT_MESSAGE_COUNT = 10;

/**
 * Compact conversation history to fit within a token budget.
 *
 * Strategy:
 * 1. If total tokens fit the budget, return messages as-is.
 * 2. Keep the last `recentMessageCount` messages intact.
 * 3. Drop the oldest non-recent messages one at a time until the budget fits.
 * 4. If any messages were dropped, prepend a system message noting the truncation.
 */
export function compactHistory(
  messages: Message[],
  options: CompactionOptions,
  counter: TokenCounter,
): Message[] {
  const reserveForResponse =
    options.reserveForResponse ?? DEFAULT_RESERVE_FOR_RESPONSE;
  const recentMessageCount =
    options.recentMessageCount ?? DEFAULT_RECENT_MESSAGE_COUNT;

  const budget =
    options.maxTokens - reserveForResponse - options.systemPromptTokens;

  // If budget is non-positive, just return recent messages
  if (budget <= 0) {
    return messages.slice(-recentMessageCount);
  }

  // Check whether messages already fit
  const totalTokens = counter.countMessages(messages);
  if (totalTokens <= budget) {
    return messages;
  }

  // Split into droppable (older) and protected (recent) portions
  const recentStart = Math.max(0, messages.length - recentMessageCount);
  const droppable = messages.slice(0, recentStart);
  const recent = messages.slice(recentStart);

  // Pre-compute the cost of the truncation marker so we can account for it
  const marker: Message = {
    role: "system",
    content: TRUNCATION_MARKER,
  };
  const markerTokens = counter.countMessages([marker]);

  // Start dropping from the oldest, reserving space for the marker
  let remaining = [...droppable];
  let currentTokens = counter.countMessages([...remaining, ...recent]);

  while (remaining.length > 0 && currentTokens + markerTokens > budget) {
    remaining.shift();
    currentTokens = counter.countMessages([...remaining, ...recent]);
  }

  const dropped = droppable.length - remaining.length;

  if (dropped === 0) {
    return messages;
  }

  return [marker, ...remaining, ...recent];
}
