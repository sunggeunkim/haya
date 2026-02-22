import { describe, it, expect } from "vitest";
import {
  deriveGoogleChatSessionKey,
  verifyBearerToken,
  parseGoogleChatEvent,
  createGoogleChatChannel,
} from "./index.js";

describe("deriveGoogleChatSessionKey", () => {
  it("creates per-space session key from full space name", () => {
    const key = deriveGoogleChatSessionKey("spaces/AAAA_BBB");
    expect(key).toBe("google-chat:space:AAAA_BBB");
  });

  it("handles space name without prefix", () => {
    const key = deriveGoogleChatSessionKey("MY_SPACE_ID");
    expect(key).toBe("google-chat:space:MY_SPACE_ID");
  });

  it("strips only the spaces/ prefix", () => {
    const key = deriveGoogleChatSessionKey("spaces/abc/def");
    expect(key).toBe("google-chat:space:abc/def");
  });
});

describe("verifyBearerToken", () => {
  it("returns true for valid Bearer token", () => {
    expect(verifyBearerToken("Bearer my-secret-token", "my-secret-token")).toBe(
      true,
    );
  });

  it("returns false for missing header", () => {
    expect(verifyBearerToken(undefined, "my-secret-token")).toBe(false);
  });

  it("returns false for wrong token", () => {
    expect(verifyBearerToken("Bearer wrong-token", "my-secret-token")).toBe(
      false,
    );
  });

  it("returns false for non-Bearer scheme", () => {
    expect(verifyBearerToken("Basic my-secret-token", "my-secret-token")).toBe(
      false,
    );
  });

  it("returns false for malformed header", () => {
    expect(verifyBearerToken("BearerTokenNoSpace", "TokenNoSpace")).toBe(false);
  });
});

describe("parseGoogleChatEvent", () => {
  it("parses valid MESSAGE event", () => {
    const event = parseGoogleChatEvent(
      JSON.stringify({
        type: "MESSAGE",
        message: {
          text: "Hello bot!",
          sender: { displayName: "Alice", name: "users/123" },
          space: { name: "spaces/ABC" },
          thread: { name: "spaces/ABC/threads/T1" },
          createTime: "2025-01-01T00:00:00Z",
        },
      }),
    );

    expect(event).not.toBeNull();
    expect(event!.type).toBe("MESSAGE");
    expect(event!.message!.text).toBe("Hello bot!");
    expect(event!.message!.sender!.displayName).toBe("Alice");
    expect(event!.message!.space!.name).toBe("spaces/ABC");
    expect(event!.message!.thread!.name).toBe("spaces/ABC/threads/T1");
  });

  it("returns null for invalid JSON", () => {
    expect(parseGoogleChatEvent("not json")).toBeNull();
  });

  it("returns object for empty JSON body", () => {
    expect(parseGoogleChatEvent("{}")).toEqual({});
  });
});

describe("createGoogleChatChannel", () => {
  it("returns a ChannelPlugin with correct id and name", () => {
    const channel = createGoogleChatChannel();

    expect(channel.id).toBe("google-chat");
    expect(channel.name).toBe("Google Chat");
  });

  it("has text chat capability with thread support", () => {
    const channel = createGoogleChatChannel();

    expect(channel.capabilities.chatTypes).toContain("text");
    expect(channel.capabilities.threads).toBe(true);
  });

  it("starts as disconnected", () => {
    const channel = createGoogleChatChannel();
    const status = channel.status();

    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });

  it("throws when sending message while disconnected", async () => {
    const channel = createGoogleChatChannel();

    await expect(
      channel.sendMessage("spaces/ABC", { content: "hello" }),
    ).rejects.toThrow("not connected");
  });

  it("has required ChannelPlugin methods", () => {
    const channel = createGoogleChatChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });
});
