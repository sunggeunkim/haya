import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createGatewayWsServer, type GatewayWsServer } from "./server-ws.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silly: vi.fn(),
  } as unknown as import("tslog").Logger<unknown>;
}

let httpServer: Server;
let wsServer: GatewayWsServer;

afterEach(async () => {
  if (wsServer) {
    await wsServer.close().catch(() => {});
  }
  if (httpServer?.listening) {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }
});

async function setup() {
  httpServer = createServer();
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  wsServer = createGatewayWsServer({
    server: httpServer,
    authConfig: { mode: "token", token: "test-secret", trustedProxies: [] },
    logger: makeLogger(),
  });
  return { httpServer, wsServer };
}

describe("gateway WS server", () => {
  it("clientCount() returns 0 initially", async () => {
    const { wsServer: ws } = await setup();
    expect(ws.clientCount()).toBe(0);
  });

  it("broadcast() to zero clients does not throw", async () => {
    const { wsServer: ws } = await setup();
    expect(() => ws.broadcast("test-event", { foo: "bar" })).not.toThrow();
  });

  it("close() returns a promise that resolves", async () => {
    const { wsServer: ws } = await setup();
    await expect(ws.close()).resolves.toBeUndefined();
  });
});
