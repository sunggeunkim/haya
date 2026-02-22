import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMessageTools } from "./message-tools.js";
import type { AgentTool } from "./types.js";
import type { ChannelRegistry } from "../channels/registry.js";

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function createMockPlugin(id = "slack", name = "Slack") {
  return {
    id,
    name,
    capabilities: { chatTypes: ["direct", "group"] },
    start: vi.fn(),
    stop: vi.fn(),
    status: vi.fn().mockReturnValue({ connected: true }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockRegistry(plugins = [createMockPlugin()]): ChannelRegistry {
  const pluginMap = new Map(plugins.map((p) => [p.id, p]));
  return {
    get: vi.fn((id: string) => pluginMap.get(id)),
    list: vi.fn().mockReturnValue(plugins),
    has: vi.fn((id: string) => pluginMap.has(id)),
    size: plugins.length,
  } as unknown as ChannelRegistry;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createMessageTools", () => {
  it("returns 3 tools: message_send, message_broadcast, channels_list", () => {
    const registry = createMockRegistry();
    const tools = createMessageTools(registry);
    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["channels_list", "message_broadcast", "message_send"]);
  });
});

// ---------------------------------------------------------------------------
// message_send
// ---------------------------------------------------------------------------

describe("message_send", () => {
  let registry: ChannelRegistry;
  let tool: AgentTool;
  let mockPlugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    registry = createMockRegistry([mockPlugin]);
    tool = getTool(createMessageTools(registry), "message_send");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the correct channel's sendMessage", async () => {
    const result = await tool.execute({
      channel: "slack",
      channelId: "C123",
      content: "Hello world",
    });

    expect(mockPlugin.sendMessage).toHaveBeenCalledWith("C123", {
      content: "Hello world",
      threadId: undefined,
    });
    expect(result).toContain("Message sent to slack:C123");
  });

  it("throws when channel not found", async () => {
    await expect(
      tool.execute({
        channel: "nonexistent",
        channelId: "C123",
        content: "Hello",
      }),
    ).rejects.toThrow('Channel "nonexistent" not found');
  });

  it("passes threadId when provided", async () => {
    await tool.execute({
      channel: "slack",
      channelId: "C123",
      content: "Reply",
      threadId: "thread-456",
    });

    expect(mockPlugin.sendMessage).toHaveBeenCalledWith("C123", {
      content: "Reply",
      threadId: "thread-456",
    });
  });
});

// ---------------------------------------------------------------------------
// message_broadcast
// ---------------------------------------------------------------------------

describe("message_broadcast", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends to all channels", async () => {
    const slack = createMockPlugin("slack", "Slack");
    const discord = createMockPlugin("discord", "Discord");
    const registry = createMockRegistry([slack, discord]);
    const tool = getTool(createMessageTools(registry), "message_broadcast");

    const result = await tool.execute({ content: "Hello everyone" });

    expect(slack.sendMessage).toHaveBeenCalledWith("default", {
      content: "Hello everyone",
    });
    expect(discord.sendMessage).toHaveBeenCalledWith("default", {
      content: "Hello everyone",
    });
    expect(result).toContain("slack: sent");
    expect(result).toContain("discord: sent");
  });

  it("reports failures per channel", async () => {
    const slack = createMockPlugin("slack", "Slack");
    const discord = createMockPlugin("discord", "Discord");
    discord.sendMessage.mockRejectedValue(new Error("Connection timeout"));
    const registry = createMockRegistry([slack, discord]);
    const tool = getTool(createMessageTools(registry), "message_broadcast");

    const result = await tool.execute({ content: "Hello" });

    expect(result).toContain("slack: sent");
    expect(result).toContain("discord: failed (Connection timeout)");
  });

  it("returns 'no channels' when empty", async () => {
    const registry = createMockRegistry([]);
    const tool = getTool(createMessageTools(registry), "message_broadcast");

    const result = await tool.execute({ content: "Hello" });

    expect(result).toContain("No channels connected");
  });
});

// ---------------------------------------------------------------------------
// channels_list
// ---------------------------------------------------------------------------

describe("channels_list", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns formatted list of channels", async () => {
    const slack = createMockPlugin("slack", "Slack");
    const discord = createMockPlugin("discord", "Discord");
    discord.status.mockReturnValue({ connected: false });
    const registry = createMockRegistry([slack, discord]);
    const tool = getTool(createMessageTools(registry), "channels_list");

    const result = await tool.execute({});

    expect(result).toContain("- slack (Slack): connected");
    expect(result).toContain("- discord (Discord): disconnected");
  });

  it("returns 'no channels' when empty", async () => {
    const registry = createMockRegistry([]);
    const tool = getTool(createMessageTools(registry), "channels_list");

    const result = await tool.execute({});

    expect(result).toContain("No channels registered");
  });
});
