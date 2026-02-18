import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { Logger } from "tslog";
import {
  authorizeRequest,
  extractCredentials,
  type AuthConfig,
  type AuthResult,
} from "./auth.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import {
  buildErrorResponse,
  buildResponse,
  parseRequest,
  serializeFrame,
} from "./protocol/frames.js";
import { ErrorCodes } from "./protocol/types.js";

/**
 * WebSocket server handler with protocol validation and authentication.
 */

export type MethodHandler = (
  params: Record<string, unknown> | undefined,
  clientId: string,
) => Promise<unknown> | unknown;

export interface WsServerOptions {
  server: HttpServer;
  authConfig: AuthConfig;
  rateLimiter?: AuthRateLimiter;
  logger: Logger<unknown>;
  methods?: Map<string, MethodHandler>;
}

export interface GatewayWsServer {
  wss: WebSocketServer;
  broadcast(event: string, data: unknown): void;
  close(): void;
  clientCount(): number;
}

let nextClientId = 0;

export function createGatewayWsServer(
  options: WsServerOptions,
): GatewayWsServer {
  const { server, authConfig, rateLimiter, logger, methods } = options;

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<string, WebSocket>();

  // Handle HTTP upgrade for WebSocket
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const credentials = extractCredentials(req);
    const authResult = authorizeRequest({
      config: authConfig,
      req,
      credentials,
      rateLimiter,
    });

    if (!authResult.ok) {
      logger.warn(`WebSocket auth rejected: ${authResult.reason}`);
      socket.write(buildHttpUpgradeReject(authResult));
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    const clientId = `client-${++nextClientId}`;
    clients.set(clientId, ws);
    logger.info(`Client connected: ${clientId}`);

    ws.on("message", async (data: Buffer | string) => {
      const raw = typeof data === "string" ? data : data.toString("utf-8");

      const parsed = parseRequest(raw);
      if (!parsed.ok) {
        ws.send(
          serializeFrame(
            buildErrorResponse("unknown", parsed.error.code, parsed.error.message),
          ),
        );
        return;
      }

      const { id, method, params } = parsed.request;

      const handler = methods?.get(method);
      if (!handler) {
        ws.send(
          serializeFrame(
            buildErrorResponse(
              id,
              ErrorCodes.METHOD_NOT_FOUND,
              `Method not found: ${method}`,
            ),
          ),
        );
        return;
      }

      try {
        const result = await handler(params, clientId);
        ws.send(serializeFrame(buildResponse(id, result)));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Internal error";
        logger.error(`Method ${method} error:`, err);
        ws.send(
          serializeFrame(
            buildErrorResponse(id, ErrorCodes.INTERNAL_ERROR, message),
          ),
        );
      }
    });

    ws.on("close", () => {
      clients.delete(clientId);
      logger.info(`Client disconnected: ${clientId}`);
    });

    ws.on("error", (err) => {
      logger.error(`WebSocket error for ${clientId}:`, err);
    });
  });

  function broadcast(event: string, data: unknown): void {
    const frame = serializeFrame({ event, data });
    for (const ws of clients.values()) {
      if (ws.readyState === ws.OPEN) {
        ws.send(frame);
      }
    }
  }

  function close(): void {
    for (const ws of clients.values()) {
      ws.close(1001, "Server shutting down");
    }
    clients.clear();
    wss.close();
  }

  function clientCount(): number {
    return clients.size;
  }

  return { wss, broadcast, close, clientCount };
}

function buildHttpUpgradeReject(authResult: AuthResult): string {
  const status = authResult.rateLimited ? 429 : 401;
  const headers = [
    `HTTP/1.1 ${status} ${authResult.rateLimited ? "Too Many Requests" : "Unauthorized"}`,
    "Content-Type: application/json",
    "Connection: close",
  ];

  if (authResult.retryAfterMs) {
    headers.push(
      `Retry-After: ${Math.ceil(authResult.retryAfterMs / 1000)}`,
    );
  }

  const body = JSON.stringify({
    error: authResult.reason,
    ...(authResult.retryAfterMs && { retryAfterMs: authResult.retryAfterMs }),
  });

  return headers.join("\r\n") + "\r\n\r\n" + body;
}
