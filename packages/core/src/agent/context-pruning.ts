/**
 * Context pruning for tool result messages.
 *
 * Two-stage strategy ported from OpenClaw:
 * 1. **Soft-trim**: Truncate verbose tool results, keeping head + tail.
 * 2. **Hard-clear**: Replace entire tool result content with a placeholder.
 *
 * Pruning only applies to messages in the "prunable range" — between the
 * first user message and the Nth-last assistant message. Recent messages
 * and bootstrap context (before the first user message) are never pruned.
 */

import type { Message } from "./types.js";

const CHARS_PER_TOKEN = 4;

export interface ContextPruningSettings {
  keepLastAssistants: number;
  softTrimRatio: number;
  hardClearRatio: number;
  minPrunableToolChars: number;
  softTrim: {
    maxChars: number;
    headChars: number;
    tailChars: number;
  };
  hardClear: {
    enabled: boolean;
    placeholder: string;
  };
}

export const DEFAULT_CONTEXT_PRUNING_SETTINGS: ContextPruningSettings = {
  keepLastAssistants: 3,
  softTrimRatio: 0.3,
  hardClearRatio: 0.5,
  minPrunableToolChars: 50_000,
  softTrim: {
    maxChars: 4_000,
    headChars: 1_500,
    tailChars: 1_500,
  },
  hardClear: {
    enabled: true,
    placeholder: "[Old tool result content cleared]",
  },
};

function estimateMessageChars(msg: Message): number {
  return msg.content.length;
}

function estimateContextChars(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageChars(msg);
  }
  return total;
}

/**
 * Find the index of the Nth-last assistant message.
 * Messages at or after this index are protected from pruning.
 * Returns `null` when there aren't enough assistant messages.
 */
function findAssistantCutoffIndex(
  messages: Message[],
  keepLastAssistants: number,
): number | null {
  if (keepLastAssistants <= 0) return messages.length;

  let remaining = keepLastAssistants;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      remaining--;
      if (remaining === 0) return i;
    }
  }
  return null;
}

/**
 * Find the index of the first user message.
 * Messages before this index are bootstrap context and should not be pruned.
 */
function findFirstUserIndex(messages: Message[]): number | null {
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") return i;
  }
  return null;
}

/**
 * Soft-trim a tool result message by keeping head + tail characters.
 * Returns the trimmed content string, or `null` if no trimming needed.
 */
function softTrimContent(
  content: string,
  settings: ContextPruningSettings,
): string | null {
  if (content.length <= settings.softTrim.maxChars) return null;

  const headChars = Math.max(0, settings.softTrim.headChars);
  const tailChars = Math.max(0, settings.softTrim.tailChars);

  if (headChars + tailChars >= content.length) return null;

  const head = content.slice(0, headChars);
  const tail = content.slice(content.length - tailChars);
  const trimNote = `\n[Tool result trimmed: kept first ${headChars} chars and last ${tailChars} chars of ${content.length} chars.]`;

  return `${head}\n...\n${tail}${trimNote}`;
}

/**
 * Prune tool result messages to reduce context size.
 *
 * @param messages - The conversation history
 * @param settings - Pruning configuration
 * @param contextWindowTokens - The context window size in tokens
 * @returns A new array of messages with pruned tool results (or the original if no pruning needed)
 */
export function pruneToolResults(
  messages: Message[],
  settings: ContextPruningSettings,
  contextWindowTokens: number,
): Message[] {
  if (messages.length === 0 || contextWindowTokens <= 0) return messages;

  const charWindow = contextWindowTokens * CHARS_PER_TOKEN;
  if (charWindow <= 0) return messages;

  const cutoffIndex = findAssistantCutoffIndex(
    messages,
    settings.keepLastAssistants,
  );
  if (cutoffIndex === null) return messages;

  const firstUserIndex = findFirstUserIndex(messages);
  const pruneStartIndex =
    firstUserIndex === null ? messages.length : firstUserIndex;

  let totalChars = estimateContextChars(messages);
  let ratio = totalChars / charWindow;

  if (ratio < settings.softTrimRatio) return messages;

  // Collect indices of prunable tool messages
  const prunableToolIndexes: number[] = [];
  let result: Message[] | null = null;

  for (let i = pruneStartIndex; i < cutoffIndex; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "tool") continue;
    prunableToolIndexes.push(i);

    const trimmed = softTrimContent(msg.content, settings);
    if (!trimmed) continue;

    const beforeChars = estimateMessageChars(msg);
    if (!result) result = messages.slice();
    result[i] = { ...msg, content: trimmed };
    const afterChars = trimmed.length;
    totalChars += afterChars - beforeChars;
  }

  const afterSoftTrim = result ?? messages;
  ratio = totalChars / charWindow;

  if (ratio < settings.hardClearRatio) return afterSoftTrim;
  if (!settings.hardClear.enabled) return afterSoftTrim;

  // Check if there's enough prunable content to make hard-clearing worthwhile
  let prunableToolChars = 0;
  for (const i of prunableToolIndexes) {
    const msg = afterSoftTrim[i];
    if (!msg || msg.role !== "tool") continue;
    prunableToolChars += estimateMessageChars(msg);
  }
  if (prunableToolChars < settings.minPrunableToolChars) return afterSoftTrim;

  // Hard-clear: replace tool content with placeholder
  for (const i of prunableToolIndexes) {
    if (ratio < settings.hardClearRatio) break;

    const msg = afterSoftTrim[i];
    if (!msg || msg.role !== "tool") continue;

    const beforeChars = estimateMessageChars(msg);
    if (!result) result = messages.slice();
    result[i] = { ...msg, content: settings.hardClear.placeholder };
    const afterChars = settings.hardClear.placeholder.length;
    totalChars += afterChars - beforeChars;
    ratio = totalChars / charWindow;
  }

  return result ?? messages;
}
