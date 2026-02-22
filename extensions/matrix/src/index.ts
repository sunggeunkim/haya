import {
  createClient,
  type MatrixClient,
  type IEvent,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { definePlugin } from "@haya/plugin-sdk";
import type {
  ChannelPlugin,
  ChannelStatus,
  ChannelConfig,
  ChannelRuntime,
  OutboundMessage,
  ChannelCapabilities,
} from "@haya/core";
import { wrapExternalContent } from "@haya/core";
import { resolveMatrixConfig, requireEnv } from "./config.js";

/**
 * Derive a session key from a Matrix message context.
 * DM rooms use per-sender sessions; group rooms use per-room sessions.
 */
export function deriveMatrixSessionKey(
  isDM: boolean,
  roomId: string,
  senderId: string,
): string {
  if (isDM) {
    return `matrix:dm:${senderId}`;
  }
  return `matrix:room:${roomId}`;
}

/**
 * Create a Matrix channel plugin using matrix-js-sdk.
 */
export function createMatrixChannel(): ChannelPlugin {
  let client: MatrixClient | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;
  let botUserId: string | undefined;

  return {
    id: "matrix",
    name: "Matrix",
    capabilities: {
      chatTypes: ["text"],
      threads: true,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const matrixConfig = resolveMatrixConfig(config.settings);
      const homeserverUrl = requireEnv(matrixConfig.homeserverUrlEnvVar);
      const accessToken = requireEnv(matrixConfig.accessTokenEnvVar);
      botUserId = requireEnv(matrixConfig.userIdEnvVar);

      client = createClient({
        baseUrl: homeserverUrl,
        accessToken,
        userId: botUserId,
      });

      // Listen for room timeline events (incoming messages)
      client.on("Room.timeline" as any, async (event: MatrixEvent, room: Room | undefined) => {
        // Only handle m.room.message events with msgtype m.text
        if (event.getType() !== "m.room.message") return;
        const content = event.getContent();
        if (content.msgtype !== "m.text") return;

        const senderId = event.getSender();
        // Skip messages from the bot itself
        if (senderId === botUserId) return;

        const roomId = event.getRoomId();
        if (!roomId || !senderId) return;

        const body = content.body as string;
        if (!body) return;

        // Check if this room is a DM (two members only)
        const members = room?.getJoinedMembers() ?? [];
        const isDM = members.length === 2;

        // Check for thread relation (m.thread)
        const relatesTo = content["m.relates_to"];
        const threadId =
          relatesTo?.rel_type === "m.thread"
            ? (relatesTo.event_id as string)
            : undefined;

        const { wrapped, suspiciousPatterns } = wrapExternalContent(body, "matrix");

        runtime.logger.info(
          `Received message from ${senderId} in ${roomId}`,
        );

        await runtime.onMessage({
          channelId: roomId,
          senderId,
          content: wrapped,
          threadId,
          channel: "matrix",
          timestamp: event.getTs(),
          metadata: {
            sessionKey: deriveMatrixSessionKey(isDM, roomId, senderId),
            isDM,
            promptInjectionWarnings: suspiciousPatterns,
          },
        });
      });

      await client.startClient({ initialSyncLimit: 0 });
      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info("Matrix channel connected");
    },

    async stop(): Promise<void> {
      if (client) {
        client.stopClient();
        client = null;
      }
      connected = false;
      connectedSince = undefined;
    },

    status(): ChannelStatus {
      return {
        connected,
        connectedSince,
        error: lastError,
      };
    },

    async sendMessage(channelId: string, message: OutboundMessage): Promise<void> {
      if (!client || !connected) {
        throw new Error("Matrix channel is not connected");
      }

      const content: Record<string, unknown> = {
        msgtype: "m.text",
        body: message.content,
      };

      // If replying in a thread, include the m.thread relation
      if (message.threadId) {
        content["m.relates_to"] = {
          rel_type: "m.thread",
          event_id: message.threadId,
        };
      }

      await client.sendEvent(channelId, "m.room.message", content);
    },
  };
}

/**
 * Matrix plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "matrix",
  name: "Matrix Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Matrix channel plugin registered");
  },
});
