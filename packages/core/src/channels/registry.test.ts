import { describe, it, expect, vi } from "vitest";
import { ChannelRegistry } from "./registry.js";
import type { ChannelPlugin, ChannelMessageHandler } from "./types.js";

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

describe("ChannelRegistry", () => {
  it("registers a channel", () => {
    const registry = new ChannelRegistry();
    const channel = createTestChannel();

    registry.register(channel);

    expect(registry.has("test-channel")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("rejects duplicate channel registration", () => {
    const registry = new ChannelRegistry();
    registry.register(createTestChannel());

    expect(() => registry.register(createTestChannel())).toThrow(
      "already registered",
    );
  });

  it("gets a channel by id", () => {
    const registry = new ChannelRegistry();
    const channel = createTestChannel();
    registry.register(channel);

    expect(registry.get("test-channel")).toBe(channel);
  });

  it("returns undefined for non-existent channel", () => {
    const registry = new ChannelRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("unregisters a channel", () => {
    const registry = new ChannelRegistry();
    registry.register(createTestChannel());

    expect(registry.unregister("test-channel")).toBe(true);
    expect(registry.has("test-channel")).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("returns false when unregistering non-existent channel", () => {
    const registry = new ChannelRegistry();
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("lists all registered channels", () => {
    const registry = new ChannelRegistry();
    registry.register(createTestChannel({ id: "slack", name: "Slack" }));
    registry.register(createTestChannel({ id: "discord", name: "Discord" }));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.id)).toContain("slack");
    expect(list.map((c) => c.id)).toContain("discord");
  });

  it("sets and gets a message handler", () => {
    const registry = new ChannelRegistry();
    const handler: ChannelMessageHandler = vi.fn();

    registry.onMessage(handler);

    expect(registry.getMessageHandler()).toBe(handler);
  });

  it("returns null when no message handler is set", () => {
    const registry = new ChannelRegistry();
    expect(registry.getMessageHandler()).toBeNull();
  });

  it("reports correct size", () => {
    const registry = new ChannelRegistry();
    expect(registry.size).toBe(0);

    registry.register(createTestChannel({ id: "a", name: "A" }));
    expect(registry.size).toBe(1);

    registry.register(createTestChannel({ id: "b", name: "B" }));
    expect(registry.size).toBe(2);

    registry.unregister("a");
    expect(registry.size).toBe(1);
  });
});
