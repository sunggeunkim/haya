import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TlsOptions } from "node:tls";
import { buildCspHeader, buildWebChatCspHeader, generateCspNonce } from "./csp.js";
import { handleWebChatRequest } from "./webchat/serve.js";

/**
 * Express-free HTTP server with security headers.
 * In Phase 2 we use the raw http module; Express 5 integration
 * will come in a later phase when we add HTTP API routes.
 */

export interface HttpServerOptions {
  tls?: TlsOptions;
  /** Override the host used in WebSocket URLs for the web chat UI. */
  host?: string;
  /** Override the port used in WebSocket URLs for the web chat UI. */
  port?: number;
  onRequest?: (req: IncomingMessage, res: ServerResponse) => void;
}

/**
 * Create an HTTP(S) server with security headers applied to every response.
 */
export function createGatewayHttpServer(
  options?: HttpServerOptions,
): HttpServer {
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const nonce = generateCspNonce();
    const url = req.url?.split("?")[0];

    // Web chat routes get a relaxed CSP that allows ws: for local dev
    const isWebChat = url === "/chat" || url === "/chat/";

    applySecurityHeaders(res, nonce, isWebChat);

    // Try web chat route first
    if (req.method === "GET" && isWebChat) {
      const wsProtocol = options?.tls ? "wss" : "ws";
      const chatHost = options?.host ?? "127.0.0.1";
      const chatPort = resolvePort(options?.port, res);

      handleWebChatRequest(req, res, {
        nonce,
        wsProtocol: wsProtocol as "ws" | "wss",
        host: chatHost,
        port: chatPort,
      });
      return;
    }

    if (options?.onRequest) {
      options.onRequest(req, res);
    } else {
      // Default: health check on GET /, 404 otherwise
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "haya", status: "running" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    }
  };

  if (options?.tls) {
    return createHttpsServer(options.tls, handler);
  }
  return createHttpServer(handler);
}

/**
 * Resolve the port number. If explicitly set, use that. Otherwise try to
 * read it from the server's socket.
 */
function resolvePort(configured: number | undefined, res: ServerResponse): number {
  if (configured !== undefined) return configured;
  const addr = res.socket?.localPort;
  return addr ?? 0;
}

/**
 * Apply security headers to every HTTP response.
 * For web chat pages, a relaxed CSP allowing ws: is used.
 */
function applySecurityHeaders(res: ServerResponse, nonce: string, webChat: boolean): void {
  const csp = webChat ? buildWebChatCspHeader(nonce) : buildCspHeader(nonce);

  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
}
