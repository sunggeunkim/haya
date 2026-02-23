import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";

// Mock node:sqlite to avoid Node 22+ requirement from @haya/core barrel import
vi.mock("node:sqlite", () => ({
  DatabaseSync: vi.fn(),
}));

import {
  createKakaoChannel,
  chunkMessage,
  buildCallbackBody,
} from "./index.js";
import type { ChannelConfig, ChannelRuntime } from "@haya/core";

/** Helper: POST JSON to a local server and return the parsed response. */
async function postJSON(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: data };
}

/** Find an available port by binding to 0. */
function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("Could not get port"));
      }
    });
  });
}

function makeRuntime(): ChannelRuntime {
  return {
    onMessage: vi.fn().mockResolvedValue(undefined),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ChannelRuntime["logger"],
  };
}

function makeConfig(overrides: Record<string, unknown> = {}): ChannelConfig {
  return { settings: overrides };
}

// ────────────────────────────────────────────────────
// Unit tests — pure functions
// ────────────────────────────────────────────────────

describe("chunkMessage", () => {
  it("returns a single chunk for short messages", () => {
    const result = chunkMessage("Hello!");
    expect(result).toEqual(["Hello!"]);
  });

  it("returns a single chunk for exactly 1000 chars", () => {
    const text = "a".repeat(1000);
    const result = chunkMessage(text);
    expect(result).toEqual([text]);
  });

  it("splits long messages into multiple chunks", () => {
    const text = "a".repeat(2500);
    const result = chunkMessage(text);
    expect(result.length).toBeGreaterThan(1);
    expect(result.length).toBeLessThanOrEqual(3);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
    }
  });

  it("splits at newline boundaries when possible", () => {
    const line = "x".repeat(400);
    const text = `${line}\n${line}\n${line}`;
    const result = chunkMessage(text);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(`${line}\n${line}`);
  });

  it("produces at most 3 chunks", () => {
    const text = "a".repeat(5000);
    const result = chunkMessage(text);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

describe("buildCallbackBody", () => {
  it("builds correct Kakao response format", () => {
    const body = buildCallbackBody(["Hello"]);
    expect(body).toEqual({
      version: "2.0",
      template: {
        outputs: [{ simpleText: { text: "Hello" } }],
      },
    });
  });

  it("builds multiple outputs for chunked messages", () => {
    const body = buildCallbackBody(["Chunk 1", "Chunk 2"]);
    expect(body).toEqual({
      version: "2.0",
      template: {
        outputs: [
          { simpleText: { text: "Chunk 1" } },
          { simpleText: { text: "Chunk 2" } },
        ],
      },
    });
  });
});

// ────────────────────────────────────────────────────
// Integration tests — HTTP server
// ────────────────────────────────────────────────────

describe("createKakaoChannel", () => {
  it("returns a valid ChannelPlugin shape", () => {
    const channel = createKakaoChannel();
    expect(channel.id).toBe("kakao");
    expect(channel.name).toBe("KakaoTalk");
    expect(channel.capabilities.chatTypes).toEqual(["text"]);
    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });

  it("reports disconnected status before start", () => {
    const channel = createKakaoChannel();
    const status = channel.status();
    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });
});

describe("KakaoTalk skill server", () => {
  let channel: ReturnType<typeof createKakaoChannel>;
  let runtime: ChannelRuntime;
  let port: number;

  beforeEach(async () => {
    port = await getRandomPort();
    channel = createKakaoChannel();
    runtime = makeRuntime();
    await channel.start(makeConfig({ port }), runtime);
  });

  afterEach(async () => {
    await channel.stop();
  });

  it("returns connected status after start", () => {
    const status = channel.status();
    expect(status.connected).toBe(true);
    expect(status.connectedSince).toBeTypeOf("number");
  });

  it("returns 404 for non-matching paths", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/wrong`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for GET requests", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/kakao/skill`);
    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/kakao/skill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("error", "Invalid JSON");
  });

  it("returns 400 when utterance or user.id is missing", async () => {
    const result = await postJSON(port, "/kakao/skill", {
      userRequest: { utterance: "hello" },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Missing/);
  });

  it("responds with useCallback:true when callbackUrl is provided", async () => {
    const result = await postJSON(port, "/kakao/skill", {
      userRequest: {
        utterance: "안녕하세요",
        user: { id: "user-123" },
        callbackUrl: "https://callback.kakao.com/abc",
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      version: "2.0",
      useCallback: true,
      data: { text: "잠시만 기다려주세요..." },
    });
  });

  it("responds with simpleText when no callbackUrl is provided", async () => {
    const result = await postJSON(port, "/kakao/skill", {
      userRequest: {
        utterance: "안녕하세요",
        user: { id: "user-456" },
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      version: "2.0",
      template: {
        outputs: [{ simpleText: { text: "메시지를 받았습니다." } }],
      },
    });
  });

  it("calls runtime.onMessage with correct inbound message", async () => {
    await postJSON(port, "/kakao/skill", {
      userRequest: {
        utterance: "테스트 메시지",
        user: { id: "user-789" },
        callbackUrl: "https://callback.kakao.com/xyz",
      },
    });

    // Wait for the async onMessage call
    await vi.waitFor(() => {
      expect(runtime.onMessage).toHaveBeenCalledTimes(1);
    });

    const call = vi.mocked(runtime.onMessage).mock.calls[0][0];
    expect(call.channelId).toBe("user-789");
    expect(call.senderId).toBe("user-789");
    expect(call.channel).toBe("kakao");
    expect(call.content).toContain("테스트 메시지");
    expect(call.metadata).toHaveProperty("sessionKey", "kakao:user:user-789");
  });

  it("sendMessage POSTs to the stored callbackUrl", async () => {
    // Set up a local server to receive the callback
    const callbackReceived = new Promise<{
      body: Record<string, unknown>;
    }>((resolve) => {
      const callbackServer = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(
          Buffer.concat(chunks).toString("utf-8"),
        ) as Record<string, unknown>;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        callbackServer.close();
        resolve({ body });
      });
      callbackServer.listen(port + 1);
    });

    // Send a skill request with a callbackUrl pointing to our local server
    await postJSON(port, "/kakao/skill", {
      userRequest: {
        utterance: "hello",
        user: { id: "cb-user" },
        callbackUrl: `http://127.0.0.1:${port + 1}/callback`,
      },
    });

    // Now send the AI response through the channel
    await channel.sendMessage("cb-user", { content: "AI 응답입니다" });

    const { body } = await callbackReceived;
    expect(body).toEqual({
      version: "2.0",
      template: {
        outputs: [{ simpleText: { text: "AI 응답입니다" } }],
      },
    });
  });

  it("removes callback entry after sendMessage", async () => {
    // Set up a callback receiver
    const callbackServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) =>
      callbackServer.listen(port + 2, resolve),
    );

    await postJSON(port, "/kakao/skill", {
      userRequest: {
        utterance: "hello",
        user: { id: "once-user" },
        callbackUrl: `http://127.0.0.1:${port + 2}/callback`,
      },
    });

    // First sendMessage should succeed
    await channel.sendMessage("once-user", { content: "first" });

    // Second sendMessage should silently skip (no callback entry)
    await channel.sendMessage("once-user", { content: "second" });
    const status = channel.status();
    expect(status.error).toMatch(/No pending callback/);

    callbackServer.close();
  });

  it("reports disconnected status after stop", async () => {
    await channel.stop();
    const status = channel.status();
    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });
});
