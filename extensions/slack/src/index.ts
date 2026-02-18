import { definePlugin } from "@haya/plugin-sdk";
import type {
  ChannelPlugin,
  ChannelStatus,
  ChannelOutboundMessage,
  ChannelInboundMessage,
  ChannelMessageHandler,
} from "@haya/core";

export interface SlackChannelConfig {
  /** Environment variable name containing the Slack bot token */
  botTokenEnvVar: string;
  /** Environment variable name containing the Slack app token (for Socket Mode) */
  appTokenEnvVar?: string;
  /** Default channel to post messages to */
  defaultChannel?: string;
}

/**
 * Create a Slack channel plugin.
 *
 * This is a structural implementation that defines the Slack channel interface.
 * Full Socket Mode / Events API integration requires @slack/bolt or
 * direct WebSocket handling, which will be wired in production.
 */
export function createSlackChannel(
  config: SlackChannelConfig,
): ChannelPlugin & { onMessage: (handler: ChannelMessageHandler) => void } {
  let connected = false;
  let connectedSince: number | undefined;
  let messageHandler: ChannelMessageHandler | null = null;

  function resolveBotToken(): string {
    const token = process.env[config.botTokenEnvVar];
    if (!token) {
      throw new Error(
        `Slack bot token not found in environment variable: ${config.botTokenEnvVar}`,
      );
    }
    return token;
  }

  return {
    id: "slack",
    name: "Slack",

    async start(): Promise<void> {
      // Validate token is available
      resolveBotToken();
      connected = true;
      connectedSince = Date.now();
    },

    async stop(): Promise<void> {
      connected = false;
      connectedSince = undefined;
    },

    status(): ChannelStatus {
      return {
        connected,
        connectedSince,
      };
    },

    async sendMessage(params: ChannelOutboundMessage): Promise<void> {
      if (!connected) {
        throw new Error("Slack channel is not connected");
      }

      const token = resolveBotToken();
      const channel = params.recipientId || config.defaultChannel;
      if (!channel) {
        throw new Error("No recipient channel specified and no default channel configured");
      }

      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          channel,
          text: params.content,
          ...(params.threadId ? { thread_ts: params.threadId } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }

      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error ?? "unknown"}`);
      }
    },

    onMessage(handler: ChannelMessageHandler): void {
      messageHandler = handler;
    },
  };
}

/**
 * Slack plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "slack",
  name: "Slack Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Slack channel plugin registered");
  },
});
