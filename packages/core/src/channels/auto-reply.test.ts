import { describe, expect, it } from "vitest";
import { AutoReplyEngine } from "./auto-reply.js";
import type { AutoReplyRule } from "./auto-reply.js";

// ---------------------------------------------------------------------------
// Helper to create a rule with sensible defaults
// ---------------------------------------------------------------------------

function rule(overrides: Partial<AutoReplyRule> & { id: string; pattern: string; reply: string }): AutoReplyRule {
  return {
    flags: "i",
    passthrough: true,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic matching
// ---------------------------------------------------------------------------

describe("AutoReplyEngine", () => {
  describe("check", () => {
    it("matches a simple pattern", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "greet", pattern: "hello", reply: "Hi there!" }),
      ]);

      const matches = engine.check("hello world");
      expect(matches).toHaveLength(1);
      expect(matches[0].reply).toBe("Hi there!");
    });

    it("performs case-insensitive matching by default", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "greet", pattern: "hello", reply: "Hi!" }),
      ]);

      const matches = engine.check("HELLO");
      expect(matches).toHaveLength(1);
      expect(matches[0].reply).toBe("Hi!");
    });

    it("respects custom regex flags", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "exact", pattern: "hello", reply: "Hi!", flags: "" }),
      ]);

      // Case-sensitive: should NOT match uppercase
      expect(engine.check("HELLO")).toHaveLength(0);

      // Case-sensitive: should match exact case
      expect(engine.check("hello")).toHaveLength(1);
    });

    it("returns multiple matches when multiple rules match", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "r1", pattern: "help", reply: "Reply 1" }),
        rule({ id: "r2", pattern: "help me", reply: "Reply 2" }),
      ]);

      const matches = engine.check("please help me");
      expect(matches).toHaveLength(2);
      expect(matches[0].reply).toBe("Reply 1");
      expect(matches[1].reply).toBe("Reply 2");
    });

    it("does not match disabled rules", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "disabled", pattern: "hello", reply: "Hi!", enabled: false }),
      ]);

      expect(engine.check("hello")).toHaveLength(0);
    });

    it("returns empty array when no rules match", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "greet", pattern: "hello", reply: "Hi!" }),
      ]);

      expect(engine.check("goodbye")).toHaveLength(0);
    });

    it("returns empty array when there are no rules", () => {
      const engine = new AutoReplyEngine();
      expect(engine.check("hello")).toHaveLength(0);
    });

    it("skips rules with invalid regex patterns", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "bad", pattern: "[invalid", reply: "Broken" }),
        rule({ id: "good", pattern: "hello", reply: "Hi!" }),
      ]);

      const matches = engine.check("hello");
      expect(matches).toHaveLength(1);
      expect(matches[0].reply).toBe("Hi!");
    });
  });

  // -------------------------------------------------------------------------
  // Channel filtering
  // -------------------------------------------------------------------------

  describe("channel filtering", () => {
    it("applies rule only to specified channels", () => {
      const engine = new AutoReplyEngine([
        rule({
          id: "slack-only",
          pattern: "deploy",
          reply: "Deploying...",
          channels: ["slack"],
        }),
      ]);

      expect(engine.check("deploy", "slack")).toHaveLength(1);
      expect(engine.check("deploy", "discord")).toHaveLength(0);
    });

    it("applies rule to all channels when channels is not specified", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "all", pattern: "hello", reply: "Hi!" }),
      ]);

      expect(engine.check("hello", "slack")).toHaveLength(1);
      expect(engine.check("hello", "discord")).toHaveLength(1);
      expect(engine.check("hello")).toHaveLength(1);
    });

    it("skips channel-specific rules when no channel is provided", () => {
      const engine = new AutoReplyEngine([
        rule({
          id: "slack-only",
          pattern: "hello",
          reply: "Hi!",
          channels: ["slack"],
        }),
      ]);

      expect(engine.check("hello")).toHaveLength(0);
    });

    it("supports multiple channels in the channels array", () => {
      const engine = new AutoReplyEngine([
        rule({
          id: "chat-channels",
          pattern: "hello",
          reply: "Hi!",
          channels: ["slack", "discord"],
        }),
      ]);

      expect(engine.check("hello", "slack")).toHaveLength(1);
      expect(engine.check("hello", "discord")).toHaveLength(1);
      expect(engine.check("hello", "telegram")).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Passthrough
  // -------------------------------------------------------------------------

  describe("passthrough", () => {
    it("defaults passthrough to true in matches", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "greet", pattern: "hello", reply: "Hi!" }),
      ]);

      const matches = engine.check("hello");
      expect(matches[0].passthrough).toBe(true);
    });

    it("respects passthrough=false", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "block", pattern: "spam", reply: "Blocked", passthrough: false }),
      ]);

      const matches = engine.check("spam message");
      expect(matches[0].passthrough).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // shouldForwardToAI
  // -------------------------------------------------------------------------

  describe("shouldForwardToAI", () => {
    it("returns true when no rules match", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "greet", pattern: "hello", reply: "Hi!" }),
      ]);

      expect(engine.shouldForwardToAI("goodbye")).toBe(true);
    });

    it("returns true when matching rules have passthrough=true", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "greet", pattern: "hello", reply: "Hi!", passthrough: true }),
      ]);

      expect(engine.shouldForwardToAI("hello")).toBe(true);
    });

    it("returns false when all matching rules have passthrough=false", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "block1", pattern: "spam", reply: "Blocked 1", passthrough: false }),
        rule({ id: "block2", pattern: "spam", reply: "Blocked 2", passthrough: false }),
      ]);

      expect(engine.shouldForwardToAI("spam")).toBe(false);
    });

    it("returns true when mixed passthrough values (at least one true)", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "block", pattern: "help", reply: "Auto-help", passthrough: false }),
        rule({ id: "forward", pattern: "help", reply: "Forwarding", passthrough: true }),
      ]);

      expect(engine.shouldForwardToAI("help me")).toBe(true);
    });

    it("returns true when there are no rules", () => {
      const engine = new AutoReplyEngine();
      expect(engine.shouldForwardToAI("anything")).toBe(true);
    });

    it("considers channel when evaluating", () => {
      const engine = new AutoReplyEngine([
        rule({
          id: "block",
          pattern: "stop",
          reply: "Stopped",
          passthrough: false,
          channels: ["slack"],
        }),
      ]);

      // Matches on slack -> blocked
      expect(engine.shouldForwardToAI("stop", "slack")).toBe(false);
      // Does not match on discord -> forwarded
      expect(engine.shouldForwardToAI("stop", "discord")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Template variables
  // -------------------------------------------------------------------------

  describe("template variables", () => {
    it("replaces {{match}} with the matched text", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "echo", pattern: "\\bhelp\\b", reply: "You said: {{match}}" }),
      ]);

      const matches = engine.check("I need help please");
      expect(matches[0].reply).toBe("You said: help");
    });

    it("replaces {{channel}} with the channel name", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "ch", pattern: "hello", reply: "Hello from {{channel}}!" }),
      ]);

      const matches = engine.check("hello", "slack");
      expect(matches[0].reply).toBe("Hello from slack!");
    });

    it("replaces {{channel}} with empty string when no channel", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "ch", pattern: "hello", reply: "Channel: {{channel}}" }),
      ]);

      const matches = engine.check("hello");
      expect(matches[0].reply).toBe("Channel: ");
    });

    it("replaces multiple template variables in the same reply", () => {
      const engine = new AutoReplyEngine([
        rule({
          id: "multi",
          pattern: "deploy",
          reply: "Deploying {{match}} on {{channel}}",
        }),
      ]);

      const matches = engine.check("deploy now", "slack");
      expect(matches[0].reply).toBe("Deploying deploy on slack");
    });
  });

  // -------------------------------------------------------------------------
  // addRule / removeRule
  // -------------------------------------------------------------------------

  describe("addRule / removeRule", () => {
    it("adds a rule that can then match", () => {
      const engine = new AutoReplyEngine();
      expect(engine.check("hello")).toHaveLength(0);

      engine.addRule(rule({ id: "greet", pattern: "hello", reply: "Hi!" }));
      expect(engine.check("hello")).toHaveLength(1);
    });

    it("removes a rule by ID", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "greet", pattern: "hello", reply: "Hi!" }),
      ]);

      const removed = engine.removeRule("greet");
      expect(removed).toBe(true);
      expect(engine.check("hello")).toHaveLength(0);
    });

    it("returns false when removing a non-existent rule", () => {
      const engine = new AutoReplyEngine();
      expect(engine.removeRule("nonexistent")).toBe(false);
    });

    it("listRules returns all rules", () => {
      const r1 = rule({ id: "r1", pattern: "hello", reply: "Hi!" });
      const r2 = rule({ id: "r2", pattern: "bye", reply: "Goodbye!" });
      const engine = new AutoReplyEngine([r1, r2]);

      const listed = engine.listRules();
      expect(listed).toHaveLength(2);
      expect(listed[0].id).toBe("r1");
      expect(listed[1].id).toBe("r2");
    });

    it("listRules returns a copy (mutation-safe)", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "r1", pattern: "hello", reply: "Hi!" }),
      ]);

      const listed = engine.listRules();
      listed.pop();

      // Original rules should be unaffected
      expect(engine.listRules()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Regex patterns
  // -------------------------------------------------------------------------

  describe("regex patterns", () => {
    it("supports complex regex patterns", () => {
      const engine = new AutoReplyEngine([
        rule({
          id: "version",
          pattern: "v\\d+\\.\\d+\\.\\d+",
          reply: "Detected version: {{match}}",
        }),
      ]);

      const matches = engine.check("Release v1.2.3 is out");
      expect(matches).toHaveLength(1);
      expect(matches[0].reply).toBe("Detected version: v1.2.3");
    });

    it("supports word boundary patterns", () => {
      const engine = new AutoReplyEngine([
        rule({ id: "exact", pattern: "\\bhello\\b", reply: "Hi!" }),
      ]);

      expect(engine.check("hello world")).toHaveLength(1);
      expect(engine.check("helloworld")).toHaveLength(0);
    });
  });
});
