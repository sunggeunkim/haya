import {
  messagingApi,
  middleware,
  type WebhookEvent,
  type MessageEvent,
  type TextEventMessage,
} from "@line/bot-sdk";
import { createServer, type Server } from "node:http";
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
import { resolveLineConfig, requireEnv } from "./config.js";

const { MessagingApiClient } = messagingApi;

/**
 * Derive a session key from a LINE message context.
 * 1:1 chats use per-user sessions; groups use per-group sessions.
 */
export function deriveLineSessionKey(
  sourceType: string,
  sourceId: string,
  userId: string,
): string {
  if (sourceType === "group") {
    return `line:group:${sourceId}`;
  }
  if (sourceType === "room") {
    return `line:group:${sourceId}`;
  }
  return `line:user:${userId}`;
}

/**
 * Create a LINE channel plugin using @line/bot-sdk.
 */
export function createLineChannel(): ChannelPlugin {
  let apiClient: InstanceType<typeof MessagingApiClient> | null = null;
  let server: Server | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;

  return {
    id: "line",
    name: "LINE",
    capabilities: {
      chatTypes: ["text"],
      threads: false,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const lineConfig = resolveLineConfig(config.settings);
      const channelAccessToken = requireEnv(lineConfig.channelAccessTokenEnvVar);
      const channelSecret = requireEnv(lineConfig.channelSecretEnvVar);

      apiClient = new MessagingApiClient({
        channelAccessToken,
      });

      const port = typeof config.settings.port === "number"
        ? config.settings.port
        : 3100;

      // Create an HTTP server to receive LINE webhooks
      const lineMiddleware = middleware({ channelSecret });

      server = createServer((req, res) => {
        // Only handle POST to /webhook
        if (req.method !== "POST" || req.url !== "/webhook") {
          res.writeHead(404);
          res.end();
          return;
        }

        lineMiddleware(req, res, async () => {
          // Parse body from middleware
          const body = (req as any).body as { events: WebhookEvent[] };
          if (!body?.events) {
            res.writeHead(200);
            res.end("OK");
            return;
          }

          for (const event of body.events) {
            if (event.type !== "message") continue;
            const messageEvent = event as MessageEvent;
            if (messageEvent.message.type !== "text") continue;

            const textMessage = messageEvent.message as TextEventMessage;
            const source = messageEvent.source;
            const userId = source.userId ?? "unknown";
            const sourceType = source.type;
            const sourceId =
              sourceType === "group"
                ? (source as any).groupId
                : sourceType === "room"
                  ? (source as any).roomId
                  : userId;

            const { wrapped, suspiciousPatterns } = wrapExternalContent(
              textMessage.text,
              "line",
            );

            runtime.logger.info(
              `Received message from ${userId} (${sourceType})`,
            );

            await runtime.onMessage({
              channelId: sourceId,
              senderId: userId,
              content: wrapped,
              channel: "line",
              timestamp: messageEvent.timestamp,
              metadata: {
                sessionKey: deriveLineSessionKey(sourceType, sourceId, userId),
                sourceType,
                replyToken: messageEvent.replyToken,
                promptInjectionWarnings: suspiciousPatterns,
              },
            });
          }

          res.writeHead(200);
          res.end("OK");
        });
      });

      await new Promise<void>((resolve) => {
        server!.listen(port, () => {
          resolve();
        });
      });

      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info(`LINE channel connected via webhook on port ${port}`);
    },

    async stop(): Promise<void> {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        server = null;
      }
      apiClient = null;
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
      if (!apiClient || !connected) {
        throw new Error("LINE channel is not connected");
      }

      // Use push message to send to a user/group
      await apiClient.pushMessage({
        to: channelId,
        messages: [
          {
            type: "text",
            text: message.content,
          },
        ],
      });
    },
  };
}

/**
 * LINE plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "line",
  name: "LINE Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("LINE channel plugin registered");
  },
});
