import { describe, it, expect } from "vitest";
import { MessageRouter } from "./router.js";
import type { InboundMessage } from "./types.js";

function makeMessage(
  overrides?: Partial<InboundMessage>,
): InboundMessage {
  return {
    channelId: "C123",
    senderId: "U456",
    content: "hello",
    channel: "slack",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("MessageRouter", () => {
  describe("DMs are always processed", () => {
    it("processes DM with channelType=im", () => {
      const router = new MessageRouter({ groupChatMode: "mentions" });
      const msg = makeMessage({
        metadata: { channelType: "im" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
      expect(result.cleanedContent).toBe("hello");
    });

    it("processes DM with channelType=personal", () => {
      const router = new MessageRouter({ groupChatMode: "commands" });
      const msg = makeMessage({
        metadata: { channelType: "personal" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
    });

    it("processes DM with channelType=private", () => {
      const router = new MessageRouter({ groupChatMode: "commands" });
      const msg = makeMessage({
        metadata: { channelType: "private" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
    });
  });

  describe("all mode", () => {
    it("processes every group message", () => {
      const router = new MessageRouter({ groupChatMode: "all" });
      const msg = makeMessage({
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
      expect(result.cleanedContent).toBe("hello");
    });

    it("processes messages without metadata", () => {
      const router = new MessageRouter({ groupChatMode: "all" });
      const msg = makeMessage();

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
    });
  });

  describe("mentions mode", () => {
    it("processes messages with @botName mention", () => {
      const router = new MessageRouter({
        groupChatMode: "mentions",
        botNames: ["haya"],
      });
      const msg = makeMessage({
        content: "@haya what time is it?",
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
      expect(result.cleanedContent).toBe("what time is it?");
    });

    it("skips messages without mention", () => {
      const router = new MessageRouter({
        groupChatMode: "mentions",
        botNames: ["haya"],
      });
      const msg = makeMessage({
        content: "just chatting",
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(false);
    });

    it("processes messages with botMentioned metadata", () => {
      const router = new MessageRouter({
        groupChatMode: "mentions",
        botNames: [],
      });
      const msg = makeMessage({
        content: "hey bot",
        metadata: { channelType: "group", botMentioned: true },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
      expect(result.cleanedContent).toBe("hey bot");
    });

    it("is case-insensitive for mentions", () => {
      const router = new MessageRouter({
        groupChatMode: "mentions",
        botNames: ["Haya"],
      });
      const msg = makeMessage({
        content: "@haya help me",
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
    });
  });

  describe("commands mode", () => {
    it("processes messages starting with command prefix", () => {
      const router = new MessageRouter({
        groupChatMode: "commands",
        commandPrefix: "/haya",
      });
      const msg = makeMessage({
        content: "/haya summarize this",
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
      expect(result.cleanedContent).toBe("summarize this");
    });

    it("skips messages without command prefix", () => {
      const router = new MessageRouter({
        groupChatMode: "commands",
        commandPrefix: "/haya",
      });
      const msg = makeMessage({
        content: "just chatting",
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(false);
    });

    it("handles leading whitespace before prefix", () => {
      const router = new MessageRouter({
        groupChatMode: "commands",
        commandPrefix: "/haya",
      });
      const msg = makeMessage({
        content: "  /haya do something",
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
      expect(result.cleanedContent).toBe("do something");
    });

    it("uses default prefix /haya", () => {
      const router = new MessageRouter({ groupChatMode: "commands" });
      const msg = makeMessage({
        content: "/haya test",
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(true);
    });
  });

  describe("defaults", () => {
    it("defaults to mentions mode", () => {
      const router = new MessageRouter();
      const msg = makeMessage({
        content: "no mention here",
        metadata: { channelType: "group" },
      });

      const result = router.shouldProcess(msg);
      expect(result.process).toBe(false);
    });
  });
});
