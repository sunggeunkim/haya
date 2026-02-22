import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutoReplyTools } from "./auto-reply-tools.js";
import type { AutoReplyStore } from "../channels/auto-reply-store.js";
import type { AutoReplyEngine } from "../channels/auto-reply.js";
import type { AutoReplyRule } from "../channels/auto-reply.js";
import type { AgentTool } from "./types.js";

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

const mockRule: AutoReplyRule = {
  id: "rule-abc-123",
  pattern: "hello",
  flags: "i",
  reply: "Hi there!",
  passthrough: true,
  enabled: true,
};

function createMockStore(): AutoReplyStore {
  return {
    add: vi.fn().mockReturnValue(mockRule),
    remove: vi.fn().mockReturnValue(true),
    list: vi.fn().mockReturnValue([mockRule]),
    get: vi.fn().mockReturnValue(mockRule),
    save: vi.fn().mockResolvedValue(undefined),
    size: 1,
  } as unknown as AutoReplyStore;
}

function createMockEngine(): AutoReplyEngine {
  return {
    addRule: vi.fn(),
    removeRule: vi.fn().mockReturnValue(true),
    listRules: vi.fn().mockReturnValue([mockRule]),
  } as unknown as AutoReplyEngine;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createAutoReplyTools", () => {
  it("returns 3 tools: auto_reply_add, auto_reply_list, auto_reply_remove", () => {
    const store = createMockStore();
    const engine = createMockEngine();
    const tools = createAutoReplyTools(store, engine);
    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["auto_reply_add", "auto_reply_list", "auto_reply_remove"]);
  });
});

// ---------------------------------------------------------------------------
// auto_reply_add
// ---------------------------------------------------------------------------

describe("auto_reply_add", () => {
  let store: AutoReplyStore;
  let engine: AutoReplyEngine;
  let tool: AgentTool;

  beforeEach(() => {
    store = createMockStore();
    engine = createMockEngine();
    tool = getTool(createAutoReplyTools(store, engine), "auto_reply_add");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates regex, adds to store and engine, and saves", async () => {
    const result = await tool.execute({
      pattern: "hello",
      reply: "Hi there!",
    });

    expect(store.add).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: "hello",
        reply: "Hi there!",
        flags: "i",
        enabled: true,
      }),
    );
    expect(engine.addRule).toHaveBeenCalledWith(mockRule);
    expect(store.save).toHaveBeenCalledOnce();
    expect(result).toContain("rule-abc-123");
    expect(result).toContain("/hello/i");
    expect(result).toContain("Hi there!");
  });

  it("throws on invalid regex", async () => {
    await expect(
      tool.execute({ pattern: "[invalid", reply: "test" }),
    ).rejects.toThrow("Invalid regex pattern");
  });

  it("throws on missing pattern", async () => {
    await expect(
      tool.execute({ reply: "test" }),
    ).rejects.toThrow("pattern is required");
  });

  it("throws on missing reply", async () => {
    await expect(
      tool.execute({ pattern: "test" }),
    ).rejects.toThrow("reply is required");
  });
});

// ---------------------------------------------------------------------------
// auto_reply_list
// ---------------------------------------------------------------------------

describe("auto_reply_list", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns formatted rules", async () => {
    const store = createMockStore();
    const engine = createMockEngine();
    const tool = getTool(createAutoReplyTools(store, engine), "auto_reply_list");

    const result = await tool.execute({});

    expect(result).toContain("rule-abc-123");
    expect(result).toContain("/hello/i");
    expect(result).toContain("Hi there!");
    expect(result).toContain("enabled");
  });

  it("returns empty message when no rules", async () => {
    const store = createMockStore();
    (store.list as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const engine = createMockEngine();
    const tool = getTool(createAutoReplyTools(store, engine), "auto_reply_list");

    const result = await tool.execute({});

    expect(result).toContain("No auto-reply rules configured");
  });
});

// ---------------------------------------------------------------------------
// auto_reply_remove
// ---------------------------------------------------------------------------

describe("auto_reply_remove", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes from store and engine", async () => {
    const store = createMockStore();
    const engine = createMockEngine();
    const tool = getTool(createAutoReplyTools(store, engine), "auto_reply_remove");

    const result = await tool.execute({ id: "rule-abc-123" });

    expect(store.remove).toHaveBeenCalledWith("rule-abc-123");
    expect(engine.removeRule).toHaveBeenCalledWith("rule-abc-123");
    expect(store.save).toHaveBeenCalledOnce();
    expect(result).toContain("rule-abc-123 removed");
  });

  it("reports not found when rule does not exist", async () => {
    const store = createMockStore();
    (store.remove as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const engine = createMockEngine();
    const tool = getTool(createAutoReplyTools(store, engine), "auto_reply_remove");

    const result = await tool.execute({ id: "no-such-rule" });

    expect(result).toContain("not found");
    expect(engine.removeRule).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("throws if id is missing", async () => {
    const store = createMockStore();
    const engine = createMockEngine();
    const tool = getTool(createAutoReplyTools(store, engine), "auto_reply_remove");

    await expect(tool.execute({})).rejects.toThrow("id is required");
  });
});
