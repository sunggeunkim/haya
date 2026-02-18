import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { SessionStore } from "../../sessions/store.js";
import type { MethodHandler } from "../server-ws.js";

/**
 * Gateway server methods for session management.
 */

const SessionCreateParamsSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
});

const SessionIdParamsSchema = z.object({
  sessionId: z.string().min(1),
});

const SessionHistoryParamsSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().min(1).optional(),
});

export function createSessionsListHandler(
  store: SessionStore,
): MethodHandler {
  return async () => {
    return { sessions: store.list() };
  };
}

export function createSessionsCreateHandler(
  store: SessionStore,
): MethodHandler {
  return async (params) => {
    const parsed = SessionCreateParamsSchema.parse(params ?? {});
    const sessionId = randomBytes(16).toString("hex");
    store.create(sessionId, { title: parsed.title, model: parsed.model });
    return { sessionId };
  };
}

export function createSessionsDeleteHandler(
  store: SessionStore,
): MethodHandler {
  return async (params) => {
    const parsed = SessionIdParamsSchema.parse(params);
    const deleted = store.delete(parsed.sessionId);
    return { deleted };
  };
}

export function createSessionsHistoryHandler(
  store: SessionStore,
): MethodHandler {
  return async (params) => {
    const parsed = SessionHistoryParamsSchema.parse(params);
    const messages = store.readMessages(parsed.sessionId);
    const limited = parsed.limit ? messages.slice(-parsed.limit) : messages;
    return { sessionId: parsed.sessionId, messages: limited };
  };
}
