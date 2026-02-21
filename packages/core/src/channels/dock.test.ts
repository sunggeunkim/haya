import { describe, it, expect, vi } from "vitest";
import { ChannelDock } from "./dock.js";
import { ChannelRegistry } from "./registry.js";
import type { ChannelPlugin, InboundMessage } from "./types.js";

function createTestChannel(
  overrides?: Partial<ChannelPlugin>,
): ChannelPlugin {
  return {
    id: "test-channel",
    name: "Test Channel",
    capabilities: { chatTypes: ["text"] },
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockReturnValue({ connected: false }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ChannelDock", () => {
  it("starts all registered channels with config and runtime", async () => {
    const registry = new ChannelRegistry();
    const ch1 = createTestChannel({ id: "slack", name: "Slack" });
    const ch2 = createTestChannel({ id: "discord", name: "Discord" });
    registry.register(ch1);
    registry.register(ch2);

    const dock = new ChannelDock(registry);
    const result = await dock.startAll();

    expect(result.started).toEqual(["slack", "discord"]);
    expect(result.failed).toEqual([]);
    expect(ch1.start).toHaveBeenCalledTimes(1);
    // Verify start was called with ChannelConfig and ChannelRuntime
    const [config, runtime] = (ch1.start as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(config).toEqual({ settings: {} });
    expect(runtime).toHaveProperty("onMessage");
    expect(runtime).toHaveProperty("logger");
    expect(dock.isRunning).toBe(true);
  });

  it("passes channel-specific configs from config map", async () => {
    const registry = new ChannelRegistry();
    const ch = createTestChannel({ id: "slack", name: "Slack" });
    registry.register(ch);

    const dock = new ChannelDock(registry);
    const configs = new Map([
      ["slack", { settings: { botTokenEnvVar: "MY_TOKEN" } }],
    ]);
    await dock.startAll(configs);

    const [config] = (ch.start as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(config.settings.botTokenEnvVar).toBe("MY_TOKEN");
  });

  it("continues starting channels when one fails", async () => {
    const registry = new ChannelRegistry();
    const failing = createTestChannel({
      id: "broken",
      name: "Broken",
      start: vi.fn().mockRejectedValue(new Error("connect failed")),
    });
    const working = createTestChannel({ id: "working", name: "Working" });
    registry.register(failing);
    registry.register(working);

    const dock = new ChannelDock(registry);
    const result = await dock.startAll();

    expect(result.started).toEqual(["working"]);
    expect(result.failed).toEqual([
      { id: "broken", error: "connect failed" },
    ]);
    expect(working.start).toHaveBeenCalledTimes(1);
  });

  it("stops all registered channels", async () => {
    const registry = new ChannelRegistry();
    const ch1 = createTestChannel({ id: "slack", name: "Slack" });
    const ch2 = createTestChannel({ id: "discord", name: "Discord" });
    registry.register(ch1);
    registry.register(ch2);

    const dock = new ChannelDock(registry);
    await dock.startAll();
    await dock.stopAll();

    expect(ch1.stop).toHaveBeenCalledTimes(1);
    expect(ch2.stop).toHaveBeenCalledTimes(1);
    expect(dock.isRunning).toBe(false);
  });

  it("handles stop errors gracefully", async () => {
    const registry = new ChannelRegistry();
    const ch = createTestChannel({
      id: "failing",
      name: "Failing",
      stop: vi.fn().mockRejectedValue(new Error("stop failed")),
    });
    registry.register(ch);

    const dock = new ChannelDock(registry);
    await dock.startAll();

    // Should not throw
    await dock.stopAll();
    expect(dock.isRunning).toBe(false);
  });

  it("starts a specific channel by id", async () => {
    const registry = new ChannelRegistry();
    const ch = createTestChannel({ id: "slack", name: "Slack" });
    registry.register(ch);

    const dock = new ChannelDock(registry);
    await dock.startChannel("slack");

    expect(ch.start).toHaveBeenCalledTimes(1);
  });

  it("throws when starting a non-existent channel", async () => {
    const registry = new ChannelRegistry();
    const dock = new ChannelDock(registry);

    await expect(dock.startChannel("nonexistent")).rejects.toThrow(
      "not found",
    );
  });

  it("stops a specific channel by id", async () => {
    const registry = new ChannelRegistry();
    const ch = createTestChannel({ id: "slack", name: "Slack" });
    registry.register(ch);

    const dock = new ChannelDock(registry);
    await dock.startChannel("slack");
    await dock.stopChannel("slack");

    expect(ch.stop).toHaveBeenCalledTimes(1);
  });

  it("throws when stopping a non-existent channel", async () => {
    const registry = new ChannelRegistry();
    const dock = new ChannelDock(registry);

    await expect(dock.stopChannel("nonexistent")).rejects.toThrow(
      "not found",
    );
  });

  it("restarts a channel (stop then start)", async () => {
    const registry = new ChannelRegistry();
    const ch = createTestChannel({ id: "slack", name: "Slack" });
    registry.register(ch);

    const dock = new ChannelDock(registry);
    await dock.startChannel("slack");
    await dock.restartChannel("slack");

    expect(ch.stop).toHaveBeenCalledTimes(1);
    // start called twice: once for initial start, once for restart
    expect(ch.start).toHaveBeenCalledTimes(2);
  });

  it("throws when restarting a non-existent channel", async () => {
    const registry = new ChannelRegistry();
    const dock = new ChannelDock(registry);

    await expect(dock.restartChannel("nonexistent")).rejects.toThrow(
      "not found",
    );
  });

  it("returns dock status with all channel statuses", async () => {
    const registry = new ChannelRegistry();
    registry.register(
      createTestChannel({
        id: "slack",
        name: "Slack",
        status: () => ({ connected: true, connectedSince: 1000 }),
      }),
    );
    registry.register(
      createTestChannel({
        id: "discord",
        name: "Discord",
        status: () => ({ connected: false, error: "auth failure" }),
      }),
    );

    const dock = new ChannelDock(registry);
    const result = dock.status();

    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]).toEqual({
      id: "slack",
      name: "Slack",
      status: { connected: true, connectedSince: 1000 },
    });
    expect(result.channels[1]).toEqual({
      id: "discord",
      name: "Discord",
      status: { connected: false, error: "auth failure" },
    });
  });

  it("starts with isRunning false", () => {
    const registry = new ChannelRegistry();
    const dock = new ChannelDock(registry);
    expect(dock.isRunning).toBe(false);
  });

  it("handles empty registry", async () => {
    const registry = new ChannelRegistry();
    const dock = new ChannelDock(registry);

    const result = await dock.startAll();
    expect(result.started).toEqual([]);
    expect(result.failed).toEqual([]);
    // No channels started, so dock is not running
    expect(dock.isRunning).toBe(false);
  });

  it("routes inbound messages to the message processor", async () => {
    const registry = new ChannelRegistry();
    let capturedRuntime: { onMessage: (msg: InboundMessage) => Promise<void> } | null =
      null;

    const ch = createTestChannel({
      id: "slack",
      name: "Slack",
      start: vi.fn().mockImplementation(async (_config, runtime) => {
        capturedRuntime = runtime;
      }),
    });
    registry.register(ch);

    const processor = vi.fn().mockResolvedValue(undefined);
    const dock = new ChannelDock(registry);
    dock.onMessage(processor);

    await dock.startChannel("slack");

    const testMessage: InboundMessage = {
      channelId: "C123",
      senderId: "U456",
      content: "hello",
      channel: "slack",
      timestamp: Date.now(),
    };

    await capturedRuntime!.onMessage(testMessage);
    expect(processor).toHaveBeenCalledWith(testMessage);
  });

  it("warns when no message processor is set", async () => {
    const registry = new ChannelRegistry();
    let capturedRuntime: { onMessage: (msg: InboundMessage) => Promise<void> } | null =
      null;

    const ch = createTestChannel({
      id: "slack",
      name: "Slack",
      start: vi.fn().mockImplementation(async (_config, runtime) => {
        capturedRuntime = runtime;
      }),
    });
    registry.register(ch);

    const dock = new ChannelDock(registry);
    // No onMessage processor set
    await dock.startChannel("slack");

    const testMessage: InboundMessage = {
      channelId: "C123",
      senderId: "U456",
      content: "hello",
      channel: "slack",
      timestamp: Date.now(),
    };

    // Should not throw — just logs a warning
    await capturedRuntime!.onMessage(testMessage);
  });

  it("isRunning is false when all channels fail", async () => {
    const registry = new ChannelRegistry();
    const failing1 = createTestChannel({
      id: "broken-1",
      name: "Broken 1",
      start: vi.fn().mockRejectedValue(new Error("fail 1")),
    });
    const failing2 = createTestChannel({
      id: "broken-2",
      name: "Broken 2",
      start: vi.fn().mockRejectedValue(new Error("fail 2")),
    });
    registry.register(failing1);
    registry.register(failing2);

    const dock = new ChannelDock(registry);
    const result = await dock.startAll();

    expect(result.started).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(dock.isRunning).toBe(false);
  });

  it("startChannel with explicit ChannelConfig", async () => {
    const registry = new ChannelRegistry();
    const ch = createTestChannel({ id: "slack", name: "Slack" });
    registry.register(ch);

    const dock = new ChannelDock(registry);
    const customConfig = { settings: { botTokenEnvVar: "CUSTOM_TOKEN" } };
    await dock.startChannel("slack", customConfig);

    const [config] = (ch.start as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(config).toEqual(customConfig);
  });

  it("restartChannel with custom config", async () => {
    const registry = new ChannelRegistry();
    const ch = createTestChannel({ id: "slack", name: "Slack" });
    registry.register(ch);

    const dock = new ChannelDock(registry);
    await dock.startChannel("slack");

    const customConfig = { settings: { botTokenEnvVar: "RESTART_TOKEN" } };
    await dock.restartChannel("slack", customConfig);

    // The restart start call is the second one (index 1)
    const [config] = (ch.start as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(config).toEqual(customConfig);
  });
});
