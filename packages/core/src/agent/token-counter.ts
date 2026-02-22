/**
 * Token counting utilities for context budget management.
 */

import type { Message } from "./types.js";

export interface TokenCounter {
  count(text: string): number;
  countMessages(messages: Message[]): number;
}

/**
 * Per-message overhead in tokens (role label, formatting, delimiters).
 */
const MESSAGE_OVERHEAD = 4;

/**
 * Create a simple token counter that uses a character/4 heuristic.
 * This approximates GPT-style BPE tokenisation without requiring
 * a tokeniser library.
 */
export function createSimpleTokenCounter(): TokenCounter {
  return {
    count(text: string): number {
      return Math.ceil(text.length / 4);
    },

    countMessages(messages: Message[]): number {
      let total = 0;
      for (const message of messages) {
        total += Math.ceil(message.content.length / 4) + MESSAGE_OVERHEAD;
      }
      return total;
    },
  };
}
