import { z } from "zod";
import type { MethodHandler } from "../server-ws.js";
import type { ChannelDock } from "../../channels/dock.js";

export function createChannelsListHandler(
  dock: ChannelDock,
): MethodHandler {
  return async () => {
    return dock.status();
  };
}

const ChannelStartParamsSchema = z.object({
  channelId: z.string(),
});

export function createChannelsStartHandler(
  dock: ChannelDock,
): MethodHandler {
  return async (params) => {
    const parsed = ChannelStartParamsSchema.parse(params);
    await dock.startChannel(parsed.channelId);
    return { ok: true };
  };
}

const ChannelStopParamsSchema = z.object({
  channelId: z.string(),
});

export function createChannelsStopHandler(
  dock: ChannelDock,
): MethodHandler {
  return async (params) => {
    const parsed = ChannelStopParamsSchema.parse(params);
    await dock.stopChannel(parsed.channelId);
    return { ok: true };
  };
}
