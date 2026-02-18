import type { IncomingMessage } from "node:http";
import { safeEqualSecret } from "../security/secret-equal.js";
import type { AuthRateLimiter, RateLimitCheckResult } from "./auth-rate-limit.js";
import { resolveClientIp } from "./net.js";

/**
 * Gateway authentication — token | password only. No "none" mode exists.
 * Fixes CRIT-1 and HIGH-2.
 */

export type AuthMode = "token" | "password";

export type AuthConfig = {
  mode: AuthMode;
  token?: string;
  password?: string;
  trustedProxies: string[];
};

export type AuthResult = {
  ok: boolean;
  method?: "token" | "password";
  reason?: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
};

type AuthCredentials = {
  token?: string;
  password?: string;
};

/**
 * Extract bearer token from Authorization header.
 */
export function extractBearerToken(req: IncomingMessage): string | undefined {
  const authHeader = headerValue(req.headers.authorization);
  if (!authHeader?.startsWith("Bearer ")) return undefined;
  return authHeader.slice("Bearer ".length).trim();
}

/**
 * Extract credentials from WebSocket connect params (sent as first message)
 * or from query string.
 */
export function extractCredentials(
  req: IncomingMessage,
  connectParams?: AuthCredentials,
): AuthCredentials {
  const bearerToken = extractBearerToken(req);
  return {
    token: connectParams?.token ?? bearerToken ?? getQueryParam(req, "token"),
    password: connectParams?.password ?? getQueryParam(req, "password"),
  };
}

/**
 * Authorize a gateway connection request.
 */
export function authorizeRequest(params: {
  config: AuthConfig;
  req: IncomingMessage;
  credentials: AuthCredentials;
  rateLimiter?: AuthRateLimiter;
}): AuthResult {
  const { config, req, credentials, rateLimiter } = params;

  const clientIp = resolveClientIp({
    remoteAddr: req.socket?.remoteAddress,
    forwardedFor: headerValue(req.headers["x-forwarded-for"]),
    realIp: headerValue(req.headers["x-real-ip"]),
    trustedProxies: config.trustedProxies,
  });

  // Check rate limit before processing credentials
  if (rateLimiter) {
    const check: RateLimitCheckResult = rateLimiter.check(clientIp);
    if (!check.allowed) {
      return {
        ok: false,
        reason: "Rate limited",
        rateLimited: true,
        retryAfterMs: check.retryAfterMs,
      };
    }
  }

  let result: AuthResult;

  if (config.mode === "token") {
    if (safeEqualSecret(credentials.token ?? null, config.token ?? null)) {
      result = { ok: true, method: "token" };
    } else {
      result = { ok: false, reason: "Invalid or missing token" };
    }
  } else if (config.mode === "password") {
    if (safeEqualSecret(credentials.password ?? null, config.password ?? null)) {
      result = { ok: true, method: "password" };
    } else {
      result = { ok: false, reason: "Invalid or missing password" };
    }
  } else {
    // This should be impossible due to Zod schema validation
    result = { ok: false, reason: "Unknown auth mode" };
  }

  // Record rate limit outcome
  if (rateLimiter && clientIp) {
    if (result.ok) {
      rateLimiter.reset(clientIp);
    } else {
      rateLimiter.recordFailure(clientIp);
    }
  }

  return result;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getQueryParam(req: IncomingMessage, name: string): string | undefined {
  const url = req.url;
  if (!url) return undefined;
  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}
