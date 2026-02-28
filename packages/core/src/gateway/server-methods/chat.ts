import { z } from "zod";
import type { ContextPruningSettings } from "../../agent/context-pruning.js";
import type { SummarizerConfig } from "../../agent/summarizer.js";
import type { AgentRuntime } from "../../agent/runtime.js";
import type { HistoryManager } from "../../sessions/history.js";
import type { ClientEventSender, MethodHandler } from "../server-ws.js";

/**
 * chat.send — Send a message and get an AI response.
 * Streams intermediate deltas as `chat.delta` events when available.
 */

const ChatSendParamsSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
});

export function createChatSendHandler(
  runtime: AgentRuntime,
  history: HistoryManager,
  options?: {
    maxContextTokens?: number;
    systemPromptTokens?: number;
    contextPruning?: ContextPruningSettings;
    summarizer?: SummarizerConfig;
  },
): MethodHandler {
  return async (params, _clientId, send) => {
    const parsed = ChatSendParamsSchema.parse(params);

    const historyOpts = {
      maxTokens: options?.maxContextTokens,
      systemPromptTokens: options?.systemPromptTokens,
      contextPruning: options?.contextPruning,
      summarizer: options?.summarizer,
    };
    const sessionHistory = options?.summarizer
      ? await history.getHistoryAsync(parsed.sessionId, historyOpts)
      : history.getHistory(parsed.sessionId, historyOpts);

    const onChunk = send
      ? (chunk: { sessionId: string; delta: string; done: boolean }) => {
          send("chat.delta", chunk);
        }
      : undefined;

    const response = await runtime.chat(
      {
        sessionId: parsed.sessionId,
        message: parsed.message,
        model: parsed.model,
        systemPrompt: parsed.systemPrompt,
      },
      sessionHistory,
      onChunk,
    );

    // Persist the user message and assistant response
    history.addMessages(parsed.sessionId, [
      {
        role: "user",
        content: parsed.message,
        timestamp: Date.now(),
      },
      response.message,
    ]);

    return {
      sessionId: response.sessionId,
      message: response.message,
      usage: response.usage,
    };
  };
}
