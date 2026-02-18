import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { authorizeRequest, extractBearerToken, type AuthConfig } from "./auth.js";

function mockRequest(overrides: {
  headers?: Record<string, string | string[]>;
  url?: string;
  remoteAddress?: string;
}): IncomingMessage {
  const socket = {
    remoteAddress: overrides.remoteAddress ?? "127.0.0.1",
  } as Socket;

  return {
    headers: overrides.headers ?? {},
    url: overrides.url ?? "/",
    socket,
  } as unknown as IncomingMessage;
}

describe("extractBearerToken", () => {
  it("extracts token from Authorization header", () => {
    const req = mockRequest({
      headers: { authorization: "Bearer my-token-123" },
    });
    expect(extractBearerToken(req)).toBe("my-token-123");
  });

  it("returns undefined when no Authorization header", () => {
    const req = mockRequest({});
    expect(extractBearerToken(req)).toBeUndefined();
  });

  it("returns undefined for non-Bearer auth", () => {
    const req = mockRequest({
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractBearerToken(req)).toBeUndefined();
  });
});

describe("authorizeRequest", () => {
  const validToken = "a".repeat(64);
  const tokenConfig: AuthConfig = {
    mode: "token",
    token: validToken,
    trustedProxies: [],
  };

  const validPassword = "p".repeat(16);
  const passwordConfig: AuthConfig = {
    mode: "password",
    password: validPassword,
    trustedProxies: [],
  };

  it("accepts valid token credential", () => {
    const req = mockRequest({});
    const result = authorizeRequest({
      config: tokenConfig,
      req,
      credentials: { token: validToken },
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("token");
  });

  it("rejects invalid token", () => {
    const req = mockRequest({});
    const result = authorizeRequest({
      config: tokenConfig,
      req,
      credentials: { token: "wrong-token" },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Invalid");
  });

  it("rejects missing token", () => {
    const req = mockRequest({});
    const result = authorizeRequest({
      config: tokenConfig,
      req,
      credentials: {},
    });
    expect(result.ok).toBe(false);
  });

  it("accepts valid password credential", () => {
    const req = mockRequest({});
    const result = authorizeRequest({
      config: passwordConfig,
      req,
      credentials: { password: validPassword },
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("password");
  });

  it("rejects invalid password", () => {
    const req = mockRequest({});
    const result = authorizeRequest({
      config: passwordConfig,
      req,
      credentials: { password: "wrong" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when rate limited", () => {
    const req = mockRequest({ remoteAddress: "1.2.3.4" });
    const mockLimiter = {
      check: () => ({ allowed: false, remaining: 0, retryAfterMs: 5000 }),
      recordFailure: () => {},
      reset: () => {},
      size: () => 1,
      prune: () => {},
      dispose: () => {},
    };

    const result = authorizeRequest({
      config: tokenConfig,
      req,
      credentials: { token: validToken },
      rateLimiter: mockLimiter,
    });
    expect(result.ok).toBe(false);
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterMs).toBe(5000);
  });

  it("records failure on invalid credentials with rate limiter", () => {
    const failures: string[] = [];
    const req = mockRequest({ remoteAddress: "1.2.3.4" });
    const mockLimiter = {
      check: () => ({ allowed: true, remaining: 5, retryAfterMs: 0 }),
      recordFailure: (ip: string | undefined) => {
        if (ip) failures.push(ip);
      },
      reset: () => {},
      size: () => 0,
      prune: () => {},
      dispose: () => {},
    };

    authorizeRequest({
      config: tokenConfig,
      req,
      credentials: { token: "bad" },
      rateLimiter: mockLimiter,
    });

    expect(failures.length).toBe(1);
  });

  it("resets rate limit on successful auth", () => {
    const resets: string[] = [];
    const req = mockRequest({ remoteAddress: "1.2.3.4" });
    const mockLimiter = {
      check: () => ({ allowed: true, remaining: 5, retryAfterMs: 0 }),
      recordFailure: () => {},
      reset: (ip: string | undefined) => {
        if (ip) resets.push(ip);
      },
      size: () => 0,
      prune: () => {},
      dispose: () => {},
    };

    authorizeRequest({
      config: tokenConfig,
      req,
      credentials: { token: validToken },
      rateLimiter: mockLimiter,
    });

    expect(resets.length).toBe(1);
  });
});
