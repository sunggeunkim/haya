import { describe, it, expect, afterEach } from "vitest";
import { createGateway, type GatewayInstance } from "./server.js";
import type { AssistantConfig } from "../config/types.js";

/**
 * Minimal AssistantConfig for gateway E2E tests.
 * Uses port 0 so the OS assigns a random available port.
 */
function createTestConfig(portOverride = 0): AssistantConfig {
  return {
    gateway: {
      port: portOverride,
      bind: "loopback",
      auth: {
        mode: "token",
        token: "a".repeat(32), // 32-char dummy token
      },
      trustedProxies: [],
    },
    agent: {
      defaultProvider: "openai",
      defaultModel: "gpt-4o",
      systemPrompt: "You are a test assistant.",
      maxHistoryMessages: 10,
      maxContextTokens: 128_000,
      toolPolicies: [],
      specialists: [],
    },
    cron: [],
    plugins: [],
  } as AssistantConfig;
}

/** Resolve the address the server is actually listening on. */
function getBaseUrl(gateway: GatewayInstance): string {
  const addr = gateway.httpServer.address();
  if (addr && typeof addr === "object") {
    return `http://127.0.0.1:${addr.port}`;
  }
  throw new Error("Server is not listening on a network address");
}

describe("Gateway E2E", () => {
  let gateway: GatewayInstance | null = null;

  afterEach(async () => {
    if (gateway) {
      await gateway.close();
      gateway = null;
    }
  });

  it("should start and respond to health checks", async () => {
    gateway = createGateway({ config: createTestConfig() });
    await gateway.listen();

    const baseUrl = getBaseUrl(gateway);
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("should respond on the root endpoint", async () => {
    gateway = createGateway({ config: createTestConfig() });
    await gateway.listen();

    const baseUrl = getBaseUrl(gateway);
    const res = await fetch(baseUrl);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ name: "haya", status: "running" });
  });

  it("should return 404 for unknown routes", async () => {
    gateway = createGateway({ config: createTestConfig() });
    await gateway.listen();

    const baseUrl = getBaseUrl(gateway);
    const res = await fetch(`${baseUrl}/nonexistent`);

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });
});
