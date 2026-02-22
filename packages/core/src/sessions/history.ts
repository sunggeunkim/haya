import { compactHistory } from "../agent/compaction.js";
import { createSimpleTokenCounter } from "../agent/token-counter.js";
import type { Message } from "../agent/types.js";
import { SessionStore } from "./store.js";

/**
 * History management for sessions.
 * Handles truncation, retrieval, and message count limits.
 */

export class HistoryManager {
  private readonly store: SessionStore;
  private readonly maxMessages: number;

  constructor(store: SessionStore, maxMessages: number = 100) {
    this.store = store;
    this.maxMessages = maxMessages;
  }

  /**
   * Get the conversation history for a session, truncated to maxMessages.
   * Keeps the most recent messages.
   * When options.maxTokens is provided, also compacts history to fit the token budget.
   */
  getHistory(
    sessionId: string,
    options?: { maxTokens?: number; systemPromptTokens?: number },
  ): Message[] {
    if (!this.store.exists(sessionId)) return [];

    const messages = this.store.readMessages(sessionId);

    let result: Message[];
    if (messages.length <= this.maxMessages) {
      result = messages;
    } else {
      // Keep the most recent messages
      result = messages.slice(-this.maxMessages);
    }

    // Apply token-aware compaction if a budget is specified
    if (options?.maxTokens) {
      const counter = createSimpleTokenCounter();
      result = compactHistory(result, {
        maxTokens: options.maxTokens,
        reserveForResponse: 4096,
        systemPromptTokens: options.systemPromptTokens ?? 0,
        recentMessageCount: 10,
      }, counter);
    }

    return result;
  }

  /**
   * Add a message to session history.
   */
  addMessage(sessionId: string, message: Message): void {
    if (!this.store.exists(sessionId)) {
      this.store.create(sessionId);
    }
    this.store.appendMessage(sessionId, message);
  }

  /**
   * Add multiple messages at once (e.g., user message + assistant response).
   */
  addMessages(sessionId: string, messages: Message[]): void {
    for (const message of messages) {
      this.addMessage(sessionId, message);
    }
  }

  /**
   * Get the message count for a session.
   */
  getMessageCount(sessionId: string): number {
    if (!this.store.exists(sessionId)) return 0;
    return this.store.readMessages(sessionId).length;
  }
}
