import { describe, it, expect } from "vitest";
import { deriveSignalSessionKey, createSignalChannel } from "./index.js";

describe("deriveSignalSessionKey", () => {
  it("creates per-phone session key for DMs", () => {
    const key = deriveSignalSessionKey("+1234567890", undefined);
    expect(key).toBe("signal:dm:+1234567890");
  });

  it("creates per-group session key for group messages", () => {
    const key = deriveSignalSessionKey("+1234567890", "abc123groupid");
    expect(key).toBe("signal:group:abc123groupid");
  });

  it("prefers group key when both phone and group are present", () => {
    const key = deriveSignalSessionKey("+9999999999", "group-xyz");
    expect(key).toBe("signal:group:group-xyz");
  });

  it("handles undefined phone number for DM (edge case)", () => {
    const key = deriveSignalSessionKey(undefined, undefined);
    expect(key).toBe("signal:dm:undefined");
  });
});

describe("createSignalChannel", () => {
  it("returns a ChannelPlugin with correct id and name", () => {
    const channel = createSignalChannel();

    expect(channel.id).toBe("signal");
    expect(channel.name).toBe("Signal");
  });

  it("has text chat capability without thread support", () => {
    const channel = createSignalChannel();

    expect(channel.capabilities.chatTypes).toContain("text");
    expect(channel.capabilities.threads).toBe(false);
  });

  it("starts as disconnected", () => {
    const channel = createSignalChannel();
    const status = channel.status();

    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });

  it("throws when sending message while disconnected", async () => {
    const channel = createSignalChannel();

    await expect(
      channel.sendMessage("+1234567890", { content: "hello" }),
    ).rejects.toThrow("not connected");
  });

  it("has required ChannelPlugin methods", () => {
    const channel = createSignalChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });

  it("stop is safe to call when not started", async () => {
    const channel = createSignalChannel();

    // Should not throw
    await channel.stop();

    const status = channel.status();
    expect(status.connected).toBe(false);
  });
});
