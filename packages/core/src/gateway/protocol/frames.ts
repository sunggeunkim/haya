import { GatewayRequestSchema } from "./schema.js";
import { ErrorCodes, type GatewayError, type GatewayResponse } from "./types.js";

/**
 * Parse and validate an incoming WebSocket message as a GatewayRequest.
 * Returns the parsed request or a protocol error.
 */
export function parseRequest(
  raw: string,
): { ok: true; request: { id: string; method: string; params?: Record<string, unknown> } }
  | { ok: false; error: GatewayError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: { code: ErrorCodes.PARSE_ERROR, message: "Invalid JSON" },
    };
  }

  const result = GatewayRequestSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: ErrorCodes.INVALID_REQUEST,
        message: `Invalid request: ${result.error.issues.map((i) => i.message).join(", ")}`,
      },
    };
  }

  return { ok: true, request: result.data };
}

/**
 * Build a success response frame.
 */
export function buildResponse(id: string, result: unknown): GatewayResponse {
  return { id, result };
}

/**
 * Build an error response frame.
 */
export function buildErrorResponse(
  id: string,
  code: number,
  message: string,
): GatewayResponse {
  return { id, error: { code, message } };
}

/**
 * Build an event frame (server-initiated, no id).
 */
export function buildEvent(
  event: string,
  data: unknown,
): { event: string; data: unknown } {
  return { event, data };
}

/**
 * Serialize a frame to JSON for sending over WebSocket.
 */
export function serializeFrame(frame: unknown): string {
  return JSON.stringify(frame);
}
