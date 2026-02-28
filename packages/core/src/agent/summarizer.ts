/**
 * LLM-based message summarization for context compaction.
 *
 * When the conversation exceeds the token budget, instead of just dropping
 * messages with a truncation marker, we can summarize the dropped messages
 * using an LLM call and include the summary as a system message.
 */

import type { TokenCounter } from "./token-counter.js";
import type { Message } from "./types.js";

const SUMMARIZE_SYSTEM_PROMPT =
  "You are a conversation summarizer. Summarize the following conversation messages " +
  "concisely, preserving key decisions, action items, important facts, and context. " +
  "Keep the summary under 500 words. Focus on information that would be needed to " +
  "continue the conversation coherently.";

const MERGE_SUMMARIES_PROMPT =
  "Merge these partial summaries into a single cohesive summary. " +
  "Preserve decisions, action items, open questions, and any constraints.";

const DEFAULT_SUMMARY_FALLBACK = "[Earlier conversation history was summarized]";

export interface SummarizerConfig {
  /** Provider's complete function. */
  complete: (messages: Message[]) => Promise<string>;
  /** Model to use for summarization. */
  model?: string;
  /** Token budget to reserve for the summary response. */
  reserveTokens?: number;
}

/**
 * Format messages into a text block for summarization.
 */
function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .map((m) => {
      const role = m.role.toUpperCase();
      const content = m.role === "tool"
        ? m.content.slice(0, 2000) + (m.content.length > 2000 ? "..." : "")
        : m.content;
      return `[${role}]: ${content}`;
    })
    .join("\n\n");
}

/**
 * Chunk messages by maximum token count per chunk.
 */
export function chunkMessagesByMaxTokens(
  messages: Message[],
  maxTokensPerChunk: number,
  counter: TokenCounter,
): Message[][] {
  if (messages.length === 0) return [];

  const chunks: Message[][] = [];
  let currentChunk: Message[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgTokens = counter.count(msg.content) + 4; // MESSAGE_OVERHEAD
    if (currentChunk.length > 0 && currentTokens + msgTokens > maxTokensPerChunk) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
    currentChunk.push(msg);
    currentTokens += msgTokens;

    // If a single message exceeds the chunk limit, flush it as its own chunk
    if (msgTokens > maxTokensPerChunk) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Summarize a list of messages using an LLM.
 *
 * Strategy:
 * 1. If messages fit in a single chunk, summarize directly.
 * 2. If messages are too large, split into chunks, summarize each, then merge.
 * 3. On any failure, fall back to a simple truncation marker.
 */
export async function summarizeMessages(
  messages: Message[],
  config: SummarizerConfig,
  counter: TokenCounter,
): Promise<string> {
  if (messages.length === 0) return DEFAULT_SUMMARY_FALLBACK;

  const reserveTokens = config.reserveTokens ?? 2048;
  const maxChunkTokens = Math.max(1000, reserveTokens * 4);

  try {
    const chunks = chunkMessagesByMaxTokens(messages, maxChunkTokens, counter);

    if (chunks.length <= 1) {
      return await summarizeSingleChunk(chunks[0] ?? messages, config);
    }

    // Summarize each chunk, then merge
    const partialSummaries: string[] = [];
    for (const chunk of chunks) {
      const summary = await summarizeSingleChunk(chunk, config);
      partialSummaries.push(summary);
    }

    if (partialSummaries.length === 1) {
      return partialSummaries[0];
    }

    // Merge partial summaries
    return await mergeSummaries(partialSummaries, config);
  } catch (error) {
    // Fallback: return simple truncation marker
    console.warn(
      `Summarization failed, using fallback: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return `${DEFAULT_SUMMARY_FALLBACK}\n(${messages.length} messages dropped)`;
  }
}

async function summarizeSingleChunk(
  messages: Message[],
  config: SummarizerConfig,
): Promise<string> {
  const formatted = formatMessagesForSummary(messages);
  const promptMessages: Message[] = [
    { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
    { role: "user", content: formatted },
  ];

  return config.complete(promptMessages);
}

async function mergeSummaries(
  summaries: string[],
  config: SummarizerConfig,
): Promise<string> {
  const mergeInput = summaries
    .map((s, i) => `--- Part ${i + 1} ---\n${s}`)
    .join("\n\n");

  const promptMessages: Message[] = [
    { role: "system", content: MERGE_SUMMARIES_PROMPT },
    { role: "user", content: mergeInput },
  ];

  return config.complete(promptMessages);
}
