import { describe, it, expect } from "vitest";
import { deriveTeamsSessionKey, createTeamsChannel } from "./index.js";

describe("deriveTeamsSessionKey", () => {
  it("creates per-user session key for personal DMs", () => {
    const key = deriveTeamsSessionKey("personal", "conv-123", "user-456");
    expect(key).toBe("teams:dm:user-456");
  });

  it("creates per-channel session key for channel messages", () => {
    const key = deriveTeamsSessionKey("channel", "conv-123", "user-456");
    expect(key).toBe("teams:channel:conv-123");
  });

  it("creates per-channel session key for group chats", () => {
    const key = deriveTeamsSessionKey("groupChat", "conv-789", "user-456");
    expect(key).toBe("teams:channel:conv-789");
  });
});

describe("createTeamsChannel", () => {
  it("returns a ChannelPlugin with correct id and name", () => {
    const channel = createTeamsChannel();

    expect(channel.id).toBe("teams");
    expect(channel.name).toBe("Microsoft Teams");
  });

  it("has text chat capability with thread support", () => {
    const channel = createTeamsChannel();

    expect(channel.capabilities.chatTypes).toContain("text");
    expect(channel.capabilities.threads).toBe(true);
  });

  it("starts as disconnected", () => {
    const channel = createTeamsChannel();
    const status = channel.status();

    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });

  it("throws when sending message while disconnected", async () => {
    const channel = createTeamsChannel();

    await expect(
      channel.sendMessage("conv-123", { content: "hello" }),
    ).rejects.toThrow("not connected");
  });

  it("has required ChannelPlugin methods", () => {
    const channel = createTeamsChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });
});
