import { z } from "zod";
import type { AgentRuntime } from "../../agent/runtime.js";
import type { HistoryManager } from "../../sessions/history.js";
import type { MethodHandler } from "../server-ws.js";

/**
 * chat.send — Send a message and get an AI response.
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
): MethodHandler {
  return async (params) => {
    const parsed = ChatSendParamsSchema.parse(params);

    const sessionHistory = history.getHistory(parsed.sessionId);

    const response = await runtime.chat(
      {
        sessionId: parsed.sessionId,
        message: parsed.message,
        model: parsed.model,
        systemPrompt: parsed.systemPrompt,
      },
      sessionHistory,
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
