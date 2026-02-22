import { describe, it, expect } from "vitest";
import { deriveLineSessionKey, createLineChannel } from "./index.js";

describe("deriveLineSessionKey", () => {
  it("creates per-user session key for 1:1 chats", () => {
    const key = deriveLineSessionKey("user", "U123", "U123");
    expect(key).toBe("line:user:U123");
  });

  it("creates per-group session key for group chats", () => {
    const key = deriveLineSessionKey("group", "G456", "U123");
    expect(key).toBe("line:group:G456");
  });

  it("creates per-group session key for room chats", () => {
    const key = deriveLineSessionKey("room", "R789", "U123");
    expect(key).toBe("line:group:R789");
  });

  it("defaults to per-user for unknown source types", () => {
    const key = deriveLineSessionKey("unknown", "X000", "U123");
    expect(key).toBe("line:user:U123");
  });
});

describe("createLineChannel", () => {
  it("returns a ChannelPlugin with correct id and name", () => {
    const channel = createLineChannel();

    expect(channel.id).toBe("line");
    expect(channel.name).toBe("LINE");
  });

  it("has text chat capability without thread support", () => {
    const channel = createLineChannel();

    expect(channel.capabilities.chatTypes).toContain("text");
    expect(channel.capabilities.threads).toBe(false);
  });

  it("starts as disconnected", () => {
    const channel = createLineChannel();
    const status = channel.status();

    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });

  it("throws when sending message while disconnected", async () => {
    const channel = createLineChannel();

    await expect(
      channel.sendMessage("U123", { content: "hello" }),
    ).rejects.toThrow("not connected");
  });

  it("has required ChannelPlugin methods", () => {
    const channel = createLineChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });

  it("has correct capabilities shape", () => {
    const channel = createLineChannel();

    expect(channel.capabilities).toBeDefined();
    expect(channel.capabilities.reactions).toBe(false);
    expect(channel.capabilities.media).toBe(false);
  });
});
