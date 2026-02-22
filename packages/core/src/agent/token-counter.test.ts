import { describe, expect, it } from "vitest";
import { createSimpleTokenCounter } from "./token-counter.js";
import type { Message } from "./types.js";

describe("createSimpleTokenCounter", () => {
  const counter = createSimpleTokenCounter();

  describe("count", () => {
    it("counts tokens for a known string", () => {
      // 12 chars -> ceil(12/4) = 3
      expect(counter.count("Hello World!")).toBe(3);
    });

    it("returns 0 for empty string", () => {
      expect(counter.count("")).toBe(0);
    });

    it("rounds up for strings not divisible by 4", () => {
      // 5 chars -> ceil(5/4) = 2
      expect(counter.count("Hello")).toBe(2);
    });

    it("handles single character", () => {
      // 1 char -> ceil(1/4) = 1
      expect(counter.count("A")).toBe(1);
    });

    it("handles exactly divisible length", () => {
      // 8 chars -> ceil(8/4) = 2
      expect(counter.count("abcdefgh")).toBe(2);
    });

    it("handles long strings", () => {
      const longText = "a".repeat(1000);
      expect(counter.count(longText)).toBe(250);
    });
  });

  describe("countMessages", () => {
    it("counts tokens for a message array", () => {
      const messages: Message[] = [
        { role: "user", content: "Hello" }, // ceil(5/4) + 4 = 6
        { role: "assistant", content: "Hi there!" }, // ceil(9/4) + 4 = 7
      ];
      expect(counter.countMessages(messages)).toBe(13);
    });

    it("returns 0 for empty message array", () => {
      expect(counter.countMessages([])).toBe(0);
    });

    it("includes per-message overhead", () => {
      const messages: Message[] = [
        { role: "user", content: "" }, // ceil(0/4) + 4 = 4
      ];
      // Empty content still has 4 tokens overhead
      expect(counter.countMessages(messages)).toBe(4);
    });

    it("counts multiple messages with overhead each", () => {
      const messages: Message[] = [
        { role: "system", content: "Be helpful" }, // ceil(10/4) + 4 = 7
        { role: "user", content: "Hi" }, // ceil(2/4) + 4 = 5
        { role: "assistant", content: "Hello!" }, // ceil(6/4) + 4 = 6
      ];
      expect(counter.countMessages(messages)).toBe(18);
    });
  });
});
