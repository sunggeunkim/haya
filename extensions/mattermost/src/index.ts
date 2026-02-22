import { Client4, WebSocketClient } from "@mattermost/client";
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
import { resolveMattermostConfig, requireEnv, optionalEnv } from "./config.js";

/**
 * Derive a session key from a Mattermost message context.
 * DM channels use per-user sessions; regular channels use per-channel sessions.
 */
export function deriveMattermostSessionKey(
  isDM: boolean,
  channelId: string,
  userId: string,
): string {
  if (isDM) {
    return `mattermost:dm:${userId}`;
  }
  return `mattermost:channel:${channelId}`;
}

/**
 * Create a Mattermost channel plugin using @mattermost/client.
 */
export function createMattermostChannel(): ChannelPlugin {
  let restClient: typeof Client4 | null = null;
  let wsClient: WebSocketClient | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;
  let botUserId: string | undefined;

  return {
    id: "mattermost",
    name: "Mattermost",
    capabilities: {
      chatTypes: ["text"],
      threads: true,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const mmConfig = resolveMattermostConfig(config.settings);
      const serverUrl = requireEnv(mmConfig.serverUrlEnvVar);
      const accessToken = requireEnv(mmConfig.accessTokenEnvVar);
      const _botUsername = optionalEnv(mmConfig.botUsernameEnvVar);

      // Configure REST client
      Client4.setUrl(serverUrl);
      Client4.setToken(accessToken);
      restClient = Client4;

      // Fetch the bot's user ID
      const me = await Client4.getMe();
      botUserId = me.id;

      // Connect via WebSocket for real-time events
      wsClient = new WebSocketClient();
      const wsUrl = serverUrl.replace(/^http/, "ws");

      wsClient.addMessageListener(async (event: any) => {
        // Only handle "posted" events (new messages)
        if (event.event !== "posted") return;

        let post: any;
        try {
          post = JSON.parse(event.data.post);
        } catch {
          return;
        }

        // Skip messages from the bot itself
        if (post.user_id === botUserId) return;

        const content = post.message as string;
        if (!content) return;

        const channelId = post.channel_id as string;
        const userId = post.user_id as string;
        const rootId = post.root_id as string | undefined;

        // Determine if this is a DM channel
        const channelType = event.data.channel_type as string;
        const isDM = channelType === "D";

        const { wrapped, suspiciousPatterns } = wrapExternalContent(content, "mattermost");

        runtime.logger.info(
          `Received message from ${userId} in ${channelId}`,
        );

        await runtime.onMessage({
          channelId,
          senderId: userId,
          content: wrapped,
          threadId: rootId || undefined,
          channel: "mattermost",
          timestamp: post.create_at as number,
          metadata: {
            sessionKey: deriveMattermostSessionKey(isDM, channelId, userId),
            channelType,
            isDM,
            promptInjectionWarnings: suspiciousPatterns,
          },
        });
      });

      wsClient.initialize(`${wsUrl}/api/v4/websocket`, accessToken);
      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info("Mattermost channel connected via WebSocket");
    },

    async stop(): Promise<void> {
      if (wsClient) {
        wsClient.close();
        wsClient = null;
      }
      restClient = null;
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
      if (!restClient || !connected) {
        throw new Error("Mattermost channel is not connected");
      }

      const post: any = {
        channel_id: channelId,
        message: message.content,
      };

      // If replying in a thread, include root_id
      if (message.threadId) {
        post.root_id = message.threadId;
      }

      await Client4.createPost(post);
    },
  };
}

/**
 * Mattermost plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "mattermost",
  name: "Mattermost Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Mattermost channel plugin registered");
  },
});
