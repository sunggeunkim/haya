import { describe, it, expect, vi } from "vitest";
import {
  createChannelsListHandler,
  createChannelsStartHandler,
  createChannelsStopHandler,
} from "./channels.js";
import { ChannelDock } from "../../channels/dock.js";
import { ChannelRegistry } from "../../channels/registry.js";
import type { ChannelPlugin } from "../../channels/types.js";

function createTestChannel(
  overrides?: Partial<ChannelPlugin>,
): ChannelPlugin {
  return {
    id: "test-channel",
    name: "Test Channel",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockReturnValue({ connected: true }),
    ...overrides,
  };
}

describe("channels server methods", () => {
  describe("createChannelsListHandler", () => {
    it("returns dock status with channel list", async () => {
      const registry = new ChannelRegistry();
      registry.register(
        createTestChannel({
          id: "slack",
          name: "Slack",
          status: () => ({ connected: true, connectedSince: 1000 }),
        }),
      );
      const dock = new ChannelDock(registry);

      const handler = createChannelsListHandler(dock);
      const result = await handler({}, "client-1");

      expect(result).toEqual({
        channels: [
          {
            id: "slack",
            name: "Slack",
            status: { connected: true, connectedSince: 1000 },
          },
        ],
      });
    });

    it("returns empty list when no channels", async () => {
      const registry = new ChannelRegistry();
      const dock = new ChannelDock(registry);

      const handler = createChannelsListHandler(dock);
      const result = await handler({}, "client-1");

      expect(result).toEqual({ channels: [] });
    });
  });

  describe("createChannelsStartHandler", () => {
    it("starts a channel by id", async () => {
      const registry = new ChannelRegistry();
      const ch = createTestChannel({ id: "slack", name: "Slack" });
      registry.register(ch);
      const dock = new ChannelDock(registry);

      const handler = createChannelsStartHandler(dock);
      const result = await handler({ channelId: "slack" }, "client-1");

      expect(result).toEqual({ ok: true });
      expect(ch.start).toHaveBeenCalledTimes(1);
    });

    it("throws on invalid params (missing channelId)", async () => {
      const registry = new ChannelRegistry();
      const dock = new ChannelDock(registry);

      const handler = createChannelsStartHandler(dock);
      await expect(handler({}, "client-1")).rejects.toThrow();
    });

    it("throws when channel not found", async () => {
      const registry = new ChannelRegistry();
      const dock = new ChannelDock(registry);

      const handler = createChannelsStartHandler(dock);
      await expect(
        handler({ channelId: "nonexistent" }, "client-1"),
      ).rejects.toThrow("not found");
    });
  });

  describe("createChannelsStopHandler", () => {
    it("stops a channel by id", async () => {
      const registry = new ChannelRegistry();
      const ch = createTestChannel({ id: "slack", name: "Slack" });
      registry.register(ch);
      const dock = new ChannelDock(registry);

      const handler = createChannelsStopHandler(dock);
      const result = await handler({ channelId: "slack" }, "client-1");

      expect(result).toEqual({ ok: true });
      expect(ch.stop).toHaveBeenCalledTimes(1);
    });

    it("throws on invalid params (missing channelId)", async () => {
      const registry = new ChannelRegistry();
      const dock = new ChannelDock(registry);

      const handler = createChannelsStopHandler(dock);
      await expect(handler({}, "client-1")).rejects.toThrow();
    });
  });
});
