import type { Server as HttpServer } from "node:http";
import type { Logger } from "tslog";
import type { AssistantConfig } from "../config/types.js";
import { createLogger } from "../infra/logger.js";
import { createAuthRateLimiter, type AuthRateLimiter } from "./auth-rate-limit.js";
import type { AuthConfig } from "./auth.js";
import { resolveBindHost } from "./net.js";
import { createGatewayHttpServer } from "./server-http.js";
import {
  createGatewayWsServer,
  type GatewayWsServer,
  type MethodHandler,
} from "./server-ws.js";
import { buildTlsOptions } from "./tls.js";

/**
 * Gateway bootstrap — ties together HTTP server, WebSocket, auth,
 * rate limiting, and TLS.
 */

export interface GatewayInstance {
  httpServer: HttpServer;
  wsServer: GatewayWsServer;
  rateLimiter: AuthRateLimiter;
  logger: Logger<unknown>;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export interface GatewayOptions {
  config: AssistantConfig;
  methods?: Map<string, MethodHandler>;
}

export function createGateway(options: GatewayOptions): GatewayInstance {
  const { config, methods } = options;
  const gwConfig = config.gateway;

  const logger = createLogger("gateway", {
    level: config.logging?.level ?? "info",
    redact: config.logging?.redactSecrets !== false,
  });

  const rateLimiter = createAuthRateLimiter();

  const authConfig: AuthConfig = {
    mode: gwConfig.auth.mode,
    token: gwConfig.auth.token,
    password: gwConfig.auth.password,
    trustedProxies: gwConfig.trustedProxies,
  };

  // Build TLS options if configured
  const tlsOptions =
    gwConfig.tls?.enabled && gwConfig.tls.certPath && gwConfig.tls.keyPath
      ? buildTlsOptions({
          certPath: gwConfig.tls.certPath,
          keyPath: gwConfig.tls.keyPath,
        })
      : undefined;

  const httpServer = createGatewayHttpServer({ tls: tlsOptions });

  const wsServer = createGatewayWsServer({
    server: httpServer,
    authConfig,
    rateLimiter,
    logger,
    methods,
  });

  const host = resolveBindHost(gwConfig.bind);

  async function listen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(gwConfig.port, host, () => {
        const protocol = tlsOptions ? "wss" : "ws";
        logger.info(
          `Gateway listening on ${protocol}://${host}:${gwConfig.port}`,
        );
        resolve();
      });
    });
  }

  async function close(): Promise<void> {
    wsServer.close();
    rateLimiter.dispose();
    return new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { httpServer, wsServer, rateLimiter, logger, listen, close };
}
