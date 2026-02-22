import { describe, it, expect } from "vitest";
import {
  deriveIRCSessionKey,
  parsePrivmsg,
  isNickMentioned,
  stripNickPrefix,
  parsePing,
  createIRCChannel,
} from "./index.js";

describe("deriveIRCSessionKey", () => {
  it("creates per-channel session key for # channels", () => {
    const key = deriveIRCSessionKey("#general");
    expect(key).toBe("irc:channel:#general");
  });

  it("creates per-channel session key for & channels", () => {
    const key = deriveIRCSessionKey("&local");
    expect(key).toBe("irc:channel:&local");
  });

  it("creates per-nick session key for DMs", () => {
    const key = deriveIRCSessionKey("alice");
    expect(key).toBe("irc:dm:alice");
  });
});

describe("parsePrivmsg", () => {
  it("parses standard PRIVMSG to channel", () => {
    const result = parsePrivmsg(
      ":alice!alice@host PRIVMSG #general :Hello everyone",
    );
    expect(result).toEqual({
      nick: "alice",
      target: "#general",
      message: "Hello everyone",
    });
  });

  it("parses PRIVMSG to user (DM)", () => {
    const result = parsePrivmsg(
      ":bob!bob@host.com PRIVMSG haya-bot :Hey there",
    );
    expect(result).toEqual({
      nick: "bob",
      target: "haya-bot",
      message: "Hey there",
    });
  });

  it("handles messages with colons in the text", () => {
    const result = parsePrivmsg(
      ":nick!user@host PRIVMSG #chan :Hello: world: test",
    );
    expect(result).not.toBeNull();
    expect(result!.message).toBe("Hello: world: test");
  });

  it("returns null for non-PRIVMSG lines", () => {
    expect(parsePrivmsg(":server 001 nick :Welcome")).toBeNull();
    expect(parsePrivmsg("PING :token123")).toBeNull();
    expect(parsePrivmsg("")).toBeNull();
  });

  it("returns null for malformed PRIVMSG", () => {
    expect(parsePrivmsg("PRIVMSG #chan :no prefix")).toBeNull();
  });
});

describe("isNickMentioned", () => {
  it("detects colon-suffixed nick mention", () => {
    expect(isNickMentioned("haya-bot: do something", "haya-bot")).toBe(true);
  });

  it("detects comma-suffixed nick mention", () => {
    expect(isNickMentioned("haya-bot, do something", "haya-bot")).toBe(true);
  });

  it("detects space-suffixed nick mention", () => {
    expect(isNickMentioned("haya-bot do something", "haya-bot")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isNickMentioned("HAYA-BOT: hello", "haya-bot")).toBe(true);
    expect(isNickMentioned("haya-bot: hello", "HAYA-BOT")).toBe(true);
  });

  it("returns false when nick is not at start", () => {
    expect(isNickMentioned("hey haya-bot: hello", "haya-bot")).toBe(false);
  });

  it("returns false for unrelated messages", () => {
    expect(isNickMentioned("hello world", "haya-bot")).toBe(false);
  });
});

describe("stripNickPrefix", () => {
  it("strips colon-suffixed nick prefix", () => {
    expect(stripNickPrefix("haya-bot: do something", "haya-bot")).toBe(
      "do something",
    );
  });

  it("strips comma-suffixed nick prefix", () => {
    expect(stripNickPrefix("haya-bot, do something", "haya-bot")).toBe(
      "do something",
    );
  });

  it("strips space-suffixed nick prefix", () => {
    expect(stripNickPrefix("haya-bot do something", "haya-bot")).toBe(
      "do something",
    );
  });

  it("returns original message if nick is not a prefix", () => {
    expect(stripNickPrefix("hello world", "haya-bot")).toBe("hello world");
  });
});

describe("parsePing", () => {
  it("parses PING with colon prefix", () => {
    expect(parsePing("PING :server.example.com")).toBe("server.example.com");
  });

  it("parses PING without colon prefix", () => {
    expect(parsePing("PING token123")).toBe("token123");
  });

  it("returns null for non-PING lines", () => {
    expect(parsePing(":server PONG server :token")).toBeNull();
    expect(parsePing("PRIVMSG #chan :hello")).toBeNull();
  });
});

describe("createIRCChannel", () => {
  it("returns a ChannelPlugin with correct id and name", () => {
    const channel = createIRCChannel();

    expect(channel.id).toBe("irc");
    expect(channel.name).toBe("IRC");
  });

  it("has text chat capability without thread support", () => {
    const channel = createIRCChannel();

    expect(channel.capabilities.chatTypes).toContain("text");
    expect(channel.capabilities.threads).toBe(false);
  });

  it("starts as disconnected", () => {
    const channel = createIRCChannel();
    const status = channel.status();

    expect(status.connected).toBe(false);
    expect(status.connectedSince).toBeUndefined();
  });

  it("throws when sending message while disconnected", async () => {
    const channel = createIRCChannel();

    await expect(
      channel.sendMessage("#general", { content: "hello" }),
    ).rejects.toThrow("not connected");
  });

  it("has required ChannelPlugin methods", () => {
    const channel = createIRCChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.status).toBe("function");
    expect(typeof channel.sendMessage).toBe("function");
  });

  it("stop is safe to call when not started", async () => {
    const channel = createIRCChannel();

    // Should not throw
    await channel.stop();

    const status = channel.status();
    expect(status.connected).toBe(false);
  });
});
