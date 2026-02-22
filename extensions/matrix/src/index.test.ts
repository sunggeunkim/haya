import { describe, it, expect } from "vitest";
import { deriveMatrixSessionKey, createMatrixChannel } from "./index.js";

describe("deriveMatrixSessionKey", () => {
  it("creates per-room session key for group rooms", () => {
    const key = deriveMatrixSessionKey(false, "!room123:matrix.org", "@user:matrix.org");
    expect(key).toBe("matrix:room:!room123:matrix.org");
  });

  it("creates per-sender session key for DMs", () => {
    const key = deriveMatrixSessionKey(true, "!dm456:matrix.org", "@sender:matrix.org");
    expect(key).toBe("matrix:dm:@sender:matrix.org");
  });

  it("uses room key when isDM is false", () => {
    const key = deriveMatrixSessionKey(false, "!abc:example.com", "@user:example.com");
    expect(key).toMatch(/^matrix:room:/);
  });

  it("uses dm key when isDM is true", () => {
    const key = deriveMatrixSessionKey(true, "!abc:example.com", "@user:example.com");
    expect(key).toMatch(/^matrix:dm:/);
  });
});

describe("createMatrixChannel", () => {
  it("returns a ChannelPlugin with correct id and name", () => {
    const channel = createMatrixChannel();

    expect(channel.id).toBe("matrix");
    expect(channel.name).toBe("Matrix");
  });

  it("has text chat capability with thread support", () => {
    const channel = createMatrixChannel();

    expect(channel.capabilities.chatTypes).toContain("text");
    expect(channel.capabilities.threads).toBe(true);
  });

  it("starts as disconnected", () => {
    const channel = createMatrixChannel();
    const status = channel.status();

    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });

  it("throws when sending message while disconnected", async () => {
    const channel = createMatrixChannel();

    await expect(
      channel.sendMessage("!room:matrix.org", { content: "hello" }),
    ).rejects.toThrow("not connected");
  });

  it("has required ChannelPlugin methods", () => {
    const channel = createMatrixChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });

  it("has correct capabilities shape", () => {
    const channel = createMatrixChannel();

    expect(channel.capabilities).toBeDefined();
    expect(channel.capabilities.reactions).toBe(false);
    expect(channel.capabilities.media).toBe(false);
  });
});
