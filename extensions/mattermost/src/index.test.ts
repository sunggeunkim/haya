import { describe, it, expect } from "vitest";
import { deriveMattermostSessionKey, createMattermostChannel } from "./index.js";

describe("deriveMattermostSessionKey", () => {
  it("creates per-channel session key for regular channels", () => {
    const key = deriveMattermostSessionKey(false, "ch123", "user456");
    expect(key).toBe("mattermost:channel:ch123");
  });

  it("creates per-user session key for DMs", () => {
    const key = deriveMattermostSessionKey(true, "dm789", "user456");
    expect(key).toBe("mattermost:dm:user456");
  });

  it("uses channel key when isDM is false", () => {
    const key = deriveMattermostSessionKey(false, "abc", "xyz");
    expect(key).toMatch(/^mattermost:channel:/);
  });

  it("uses dm key when isDM is true", () => {
    const key = deriveMattermostSessionKey(true, "abc", "xyz");
    expect(key).toMatch(/^mattermost:dm:/);
  });
});

describe("createMattermostChannel", () => {
  it("returns a ChannelPlugin with correct id and name", () => {
    const channel = createMattermostChannel();

    expect(channel.id).toBe("mattermost");
    expect(channel.name).toBe("Mattermost");
  });

  it("has text chat capability with thread support", () => {
    const channel = createMattermostChannel();

    expect(channel.capabilities.chatTypes).toContain("text");
    expect(channel.capabilities.threads).toBe(true);
  });

  it("starts as disconnected", () => {
    const channel = createMattermostChannel();
    const status = channel.status();

    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });

  it("throws when sending message while disconnected", async () => {
    const channel = createMattermostChannel();

    await expect(
      channel.sendMessage("ch123", { content: "hello" }),
    ).rejects.toThrow("not connected");
  });

  it("has required ChannelPlugin methods", () => {
    const channel = createMattermostChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });

  it("has correct capabilities shape", () => {
    const channel = createMattermostChannel();

    expect(channel.capabilities).toBeDefined();
    expect(channel.capabilities.reactions).toBe(false);
    expect(channel.capabilities.media).toBe(false);
  });
});
