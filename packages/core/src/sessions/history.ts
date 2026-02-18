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
   */
  getHistory(sessionId: string): Message[] {
    if (!this.store.exists(sessionId)) return [];

    const messages = this.store.readMessages(sessionId);

    if (messages.length <= this.maxMessages) {
      return messages;
    }

    // Keep the most recent messages
    return messages.slice(-this.maxMessages);
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
