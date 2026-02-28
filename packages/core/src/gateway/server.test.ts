import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AssistantConfig } from "../config/types.js";
import { createGateway, type GatewayInstance } from "./server.js";

const TEST_TOKEN = "t".repeat(64);

function makeTestConfig(overrides?: Partial<AssistantConfig>): AssistantConfig {
  return {
    gateway: {
      port: 0, // Let OS pick a free port
      bind: "loopback",
      auth: { mode: "token", token: TEST_TOKEN },
      trustedProxies: [],
    },
    agent: {
      defaultProvider: "openai",
      defaultModel: "gpt-4o",
      defaultProviderApiKeyEnvVar: "TEST_KEY",
      systemPrompt: "You are a test assistant.",
      maxHistoryMessages: 100,
      toolPolicies: [],
      specialists: [],
    },
    cron: [],
    plugins: [],
    logging: { level: "error", redactSecrets: true, dir: "data/logs", maxSizeMB: 10, maxFiles: 5 },
    ...overrides,
  };
}

function getServerPort(gateway: GatewayInstance): number {
  const addr = gateway.httpServer.address();
  if (typeof addr === "object" && addr !== null) return addr.port;
  throw new Error("Could not get server port");
}

describe("Gateway server integration", () => {
  let gateway: GatewayInstance | undefined;

  afterEach(async () => {
    if (gateway?.httpServer.listening) {
      await gateway.close();
    }
    gateway = undefined;
  });

  it("starts and stops cleanly", async () => {
    const methods = new Map();
    methods.set("echo", (params: Record<string, unknown> | undefined) => params);

    gateway = createGateway({
      config: makeTestConfig(),
      methods,
    });
    await gateway.listen();
    const port = getServerPort(gateway);
    expect(port).toBeGreaterThan(0);
    await gateway.close();
    gateway = undefined;
  });

  it("accepts authenticated WebSocket connection", async () => {
    const methods = new Map();
    methods.set("echo", (params: Record<string, unknown> | undefined) => params);

    gateway = createGateway({
      config: makeTestConfig(),
      methods,
    });
    await gateway.listen();
    const port = getServerPort(gateway);

    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${TEST_TOKEN}`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", reject);
    });
  });

  it("rejects unauthenticated WebSocket connection", async () => {
    gateway = createGateway({ config: makeTestConfig() });
    await gateway.listen();
    const port = getServerPort(gateway);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    await new Promise<void>((resolve) => {
      ws.on("unexpected-response", (_, res) => {
        expect(res.statusCode).toBe(401);
        resolve();
      });
      ws.on("error", () => {
        // Expected — connection rejected
        resolve();
      });
    });
  });

  it("rejects WebSocket connection with wrong token", async () => {
    gateway = createGateway({ config: makeTestConfig() });
    await gateway.listen();
    const port = getServerPort(gateway);

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?token=wrong-token`,
    );

    await new Promise<void>((resolve) => {
      ws.on("unexpected-response", (_, res) => {
        expect(res.statusCode).toBe(401);
        resolve();
      });
      ws.on("error", () => resolve());
    });
  });

  it("handles JSON-RPC echo method", async () => {
    const methods = new Map();
    methods.set("echo", (params: Record<string, unknown> | undefined) => params);

    gateway = createGateway({
      config: makeTestConfig(),
      methods,
    });
    await gateway.listen();
    const port = getServerPort(gateway);

    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${TEST_TOKEN}`);

    const response = await new Promise<unknown>((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ id: "1", method: "echo", params: { hello: "world" } }));
      });
      ws.on("message", (data) => {
        resolve(JSON.parse(data.toString()));
        ws.close();
      });
      ws.on("error", reject);
    });

    expect(response).toEqual({
      id: "1",
      result: { hello: "world" },
    });
  });

  it("returns METHOD_NOT_FOUND for unknown methods", async () => {
    gateway = createGateway({
      config: makeTestConfig(),
      methods: new Map(),
    });
    await gateway.listen();
    const port = getServerPort(gateway);

    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${TEST_TOKEN}`);

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ id: "1", method: "nonexistent" }));
      });
      ws.on("message", (data) => {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
        ws.close();
      });
      ws.on("error", reject);
    });

    expect(response.error).toBeDefined();
    const error = response.error as { code: number; message: string };
    expect(error.code).toBe(-32601);
  });

  it("returns PARSE_ERROR for invalid JSON", async () => {
    const methods = new Map();
    gateway = createGateway({
      config: makeTestConfig(),
      methods,
    });
    await gateway.listen();
    const port = getServerPort(gateway);

    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${TEST_TOKEN}`);

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.on("open", () => {
        ws.send("not-json{");
      });
      ws.on("message", (data) => {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
        ws.close();
      });
      ws.on("error", reject);
    });

    expect(response.error).toBeDefined();
    const error = response.error as { code: number; message: string };
    expect(error.code).toBe(-32700);
  });

  it("serves health check on HTTP GET /health", async () => {
    gateway = createGateway({ config: makeTestConfig() });
    await gateway.listen();
    const port = getServerPort(gateway);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("applies security headers to HTTP responses", async () => {
    gateway = createGateway({ config: makeTestConfig() });
    await gateway.listen();
    const port = getServerPort(gateway);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("wss:");
    expect(res.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("broadcasts events to connected clients", async () => {
    const methods = new Map();
    gateway = createGateway({
      config: makeTestConfig(),
      methods,
    });
    await gateway.listen();
    const port = getServerPort(gateway);

    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${TEST_TOKEN}`);

    const eventPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.on("open", () => {
        // Small delay to ensure client is registered
        setTimeout(() => {
          gateway!.wsServer.broadcast("test.event", { msg: "hello" });
        }, 50);
      });
      ws.on("message", (data) => {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
        ws.close();
      });
      ws.on("error", reject);
    });

    const event = await eventPromise;
    expect(event.event).toBe("test.event");
    expect(event.data).toEqual({ msg: "hello" });
  });
});
