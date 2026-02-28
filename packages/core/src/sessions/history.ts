import { compactHistory, compactHistoryWithSummary } from "../agent/compaction.js";
import {
  pruneToolResults,
  type ContextPruningSettings,
} from "../agent/context-pruning.js";
import type { SummarizerConfig } from "../agent/summarizer.js";
import { createSimpleTokenCounter } from "../agent/token-counter.js";
import type { Message } from "../agent/types.js";
import { SessionStore } from "./store.js";

/**
 * History management for sessions.
 * Handles truncation, retrieval, and message count limits.
 */

export interface GetHistoryOptions {
  maxTokens?: number;
  systemPromptTokens?: number;
  contextPruning?: ContextPruningSettings;
  /** When provided, dropped messages are summarized via LLM instead of truncated. */
  summarizer?: SummarizerConfig;
}

export class HistoryManager {
  private readonly store: SessionStore;
  private readonly maxMessages: number;

  constructor(store: SessionStore, maxMessages: number = 100) {
    this.store = store;
    this.maxMessages = maxMessages;
  }

  /**
   * Get the raw messages truncated to maxMessages.
   */
  private loadAndTruncate(sessionId: string): Message[] {
    if (!this.store.exists(sessionId)) return [];
    const messages = this.store.readMessages(sessionId);
    if (messages.length <= this.maxMessages) return messages;
    return messages.slice(-this.maxMessages);
  }

  /**
   * Apply context pruning to messages.
   */
  private applyPruning(
    messages: Message[],
    options?: GetHistoryOptions,
  ): Message[] {
    if (options?.contextPruning && options.maxTokens) {
      return pruneToolResults(messages, options.contextPruning, options.maxTokens);
    }
    return messages;
  }

  /**
   * Get the conversation history for a session (sync — truncation mode only).
   * Keeps the most recent messages.
   * When options.maxTokens is provided, also compacts history to fit the token budget.
   * When options.contextPruning is provided, prunes large tool results after compaction.
   */
  getHistory(
    sessionId: string,
    options?: GetHistoryOptions,
  ): Message[] {
    let result = this.loadAndTruncate(sessionId);

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

    return this.applyPruning(result, options);
  }

  /**
   * Get conversation history with optional LLM summarization of dropped messages.
   * When options.summarizer is provided and compaction mode is "summarize",
   * dropped messages are summarized via an LLM call. Falls back to truncation on failure.
   */
  async getHistoryAsync(
    sessionId: string,
    options?: GetHistoryOptions,
  ): Promise<Message[]> {
    let result = this.loadAndTruncate(sessionId);

    if (options?.maxTokens) {
      const counter = createSimpleTokenCounter();

      if (options.summarizer) {
        const compactionResult = await compactHistoryWithSummary(
          result,
          {
            maxTokens: options.maxTokens,
            reserveForResponse: 4096,
            systemPromptTokens: options.systemPromptTokens ?? 0,
            recentMessageCount: 10,
          },
          counter,
          options.summarizer,
        );
        result = compactionResult.messages;
      } else {
        result = compactHistory(result, {
          maxTokens: options.maxTokens,
          reserveForResponse: 4096,
          systemPromptTokens: options.systemPromptTokens ?? 0,
          recentMessageCount: 10,
        }, counter);
      }
    }

    return this.applyPruning(result, options);
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
