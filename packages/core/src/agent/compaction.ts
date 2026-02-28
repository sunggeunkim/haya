/**
 * Token-aware context compaction for conversation history.
 * Drops oldest messages until the history fits within a token budget,
 * while preserving the most recent messages.
 */

import type { SummarizerConfig } from "./summarizer.js";
import type { TokenCounter } from "./token-counter.js";
import type { Message } from "./types.js";

export interface CompactionOptions {
  maxTokens: number;
  reserveForResponse: number;
  systemPromptTokens: number;
  recentMessageCount: number;
}

export interface CompactionResult {
  messages: Message[];
  droppedCount: number;
  summary?: string;
}

const TRUNCATION_MARKER =
  "[Earlier conversation history was truncated to fit context limits]";

const DEFAULT_RESERVE_FOR_RESPONSE = 4096;
const DEFAULT_RECENT_MESSAGE_COUNT = 10;

/**
 * Split messages into droppable (older) and protected (recent) portions,
 * then determine which messages to drop to fit the token budget.
 * Returns the drop result without applying any marker.
 */
function computeDropResult(
  messages: Message[],
  options: CompactionOptions,
  counter: TokenCounter,
): { remaining: Message[]; recent: Message[]; droppedMessages: Message[]; budget: number; budgetNonPositive: boolean } | null {
  const reserveForResponse =
    options.reserveForResponse ?? DEFAULT_RESERVE_FOR_RESPONSE;
  const recentMessageCount =
    options.recentMessageCount ?? DEFAULT_RECENT_MESSAGE_COUNT;

  const budget =
    options.maxTokens - reserveForResponse - options.systemPromptTokens;

  if (budget <= 0) {
    const recent = messages.slice(-recentMessageCount);
    const droppable = messages.length > recentMessageCount
      ? messages.slice(0, messages.length - recentMessageCount)
      : [];
    return { remaining: [], recent, droppedMessages: droppable, budget, budgetNonPositive: true };
  }

  const totalTokens = counter.countMessages(messages);
  if (totalTokens <= budget) {
    return null; // fits, no compaction needed
  }

  const recentStart = Math.max(0, messages.length - recentMessageCount);
  const droppable = messages.slice(0, recentStart);
  const recent = messages.slice(recentStart);

  // Estimate marker cost (for either truncation or summary)
  const markerTokens = counter.count(TRUNCATION_MARKER) + 4;

  let remaining = [...droppable];
  let currentTokens = counter.countMessages([...remaining, ...recent]);

  while (remaining.length > 0 && currentTokens + markerTokens > budget) {
    remaining.shift();
    currentTokens = counter.countMessages([...remaining, ...recent]);
  }

  const droppedCount = droppable.length - remaining.length;
  if (droppedCount === 0) return null;

  const droppedMessages = droppable.slice(0, droppedCount);
  return { remaining, recent, droppedMessages, budget, budgetNonPositive: false };
}

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
  const result = computeDropResult(messages, options, counter);
  if (!result) return messages;

  const { remaining, recent, droppedMessages, budgetNonPositive } = result;

  // When budget is non-positive, just return the recent slice without a marker
  if (budgetNonPositive) return recent;

  if (droppedMessages.length === 0) return messages;

  const marker: Message = {
    role: "system",
    content: TRUNCATION_MARKER,
  };

  return [marker, ...remaining, ...recent];
}

/**
 * Compact conversation history with LLM summarization of dropped messages.
 *
 * When a summarizer is provided and messages must be dropped, the dropped
 * messages are summarized via an LLM call instead of being replaced by a
 * simple truncation marker. Falls back to truncation on summarization failure.
 */
export async function compactHistoryWithSummary(
  messages: Message[],
  options: CompactionOptions,
  counter: TokenCounter,
  summarizer: SummarizerConfig,
): Promise<CompactionResult> {
  const dropResult = computeDropResult(messages, options, counter);
  if (!dropResult) {
    return { messages, droppedCount: 0 };
  }

  const { remaining, recent, droppedMessages } = dropResult;

  if (droppedMessages.length === 0) {
    return { messages, droppedCount: 0 };
  }

  let summaryContent: string;
  try {
    const { summarizeMessages } = await import("./summarizer.js");
    summaryContent = await summarizeMessages(droppedMessages, summarizer, counter);
  } catch {
    summaryContent = TRUNCATION_MARKER;
  }

  const summaryMessage: Message = {
    role: "system",
    content: `[Conversation summary]\n${summaryContent}`,
  };

  return {
    messages: [summaryMessage, ...remaining, ...recent],
    droppedCount: droppedMessages.length,
    summary: summaryContent,
  };
}
