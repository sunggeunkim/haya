import { describe, it, expect, vi } from "vitest";
import { ChannelDock } from "./dock.js";
import { ChannelRegistry } from "./registry.js";
import type { ChannelPlugin } from "./types.js";

function createTestChannel(
  overrides?: Partial<ChannelPlugin>,
): ChannelPlugin {
  return {
    id: "test-channel",
    name: "Test Channel",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockReturnValue({ connected: false }),
    ...overrides,
  };
}

describe("ChannelDock", () => {
  it("starts all registered channels", async () => {
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
    expect(ch2.start).toHaveBeenCalledTimes(1);
    expect(dock.isRunning).toBe(true);
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
    expect(dock.isRunning).toBe(true);

    await dock.stopAll();
    expect(dock.isRunning).toBe(false);
  });
});
