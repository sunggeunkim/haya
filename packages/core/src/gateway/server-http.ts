import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TlsOptions } from "node:tls";
import { buildCspHeader, generateCspNonce } from "./csp.js";

/**
 * Express-free HTTP server with security headers.
 * In Phase 2 we use the raw http module; Express 5 integration
 * will come in a later phase when we add HTTP API routes.
 */

export interface HttpServerOptions {
  tls?: TlsOptions;
  onRequest?: (req: IncomingMessage, res: ServerResponse) => void;
}

/**
 * Create an HTTP(S) server with security headers applied to every response.
 */
export function createGatewayHttpServer(
  options?: HttpServerOptions,
): HttpServer {
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    applySecurityHeaders(res);

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
 * Apply security headers to every HTTP response.
 */
function applySecurityHeaders(res: ServerResponse): void {
  const nonce = generateCspNonce();

  res.setHeader("Content-Security-Policy", buildCspHeader(nonce));
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
