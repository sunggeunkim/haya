import { describe, it, expect } from "vitest";
import { deriveSessionKey, createSlackChannel } from "./index.js";

describe("deriveSessionKey", () => {
  it("creates per-user session key for DMs", () => {
    const key = deriveSessionKey("im", "D12345", "U67890");
    expect(key).toBe("slack:dm:U67890");
  });

  it("creates per-channel session key for channel messages", () => {
    const key = deriveSessionKey("channel", "C12345", "U67890");
    expect(key).toBe("slack:channel:C12345");
  });

  it("creates per-channel session key for group messages", () => {
    const key = deriveSessionKey("group", "G12345", "U67890");
    expect(key).toBe("slack:channel:G12345");
  });
});

describe("createSlackChannel", () => {
  it("returns a ChannelPlugin with correct id and name", () => {
    const channel = createSlackChannel();

    expect(channel.id).toBe("slack");
    expect(channel.name).toBe("Slack");
  });

  it("has text chat capability with thread support", () => {
    const channel = createSlackChannel();

    expect(channel.capabilities.chatTypes).toContain("text");
    expect(channel.capabilities.threads).toBe(true);
  });

  it("starts as disconnected", () => {
    const channel = createSlackChannel();
    const status = channel.status();

    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });

  it("throws when sending message while disconnected", async () => {
    const channel = createSlackChannel();

    await expect(
      channel.sendMessage("C123", { content: "hello" }),
    ).rejects.toThrow("not connected");
  });

  it("has required ChannelPlugin methods", () => {
    const channel = createSlackChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });
});
