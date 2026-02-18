import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
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
import { resolveSlackConfig, requireEnv } from "./config.js";

/**
 * Derive a session key from a Slack message context.
 * DM messages use per-user sessions; channel messages use per-channel sessions.
 */
export function deriveSessionKey(
  channelType: string,
  channelId: string,
  userId: string,
): string {
  // DM (im) → per-user session; channel/group → per-channel session
  if (channelType === "im") {
    return `slack:dm:${userId}`;
  }
  return `slack:channel:${channelId}`;
}

/**
 * Create a Slack channel plugin using @slack/bolt with Socket Mode.
 */
export function createSlackChannel(): ChannelPlugin {
  let app: App | null = null;
  let webClient: WebClient | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;

  return {
    id: "slack",
    name: "Slack",
    capabilities: {
      chatTypes: ["text"],
      threads: true,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const slackConfig = resolveSlackConfig(config.settings);
      const botToken = requireEnv(slackConfig.botTokenEnvVar);
      const appToken = requireEnv(slackConfig.appTokenEnvVar);
      const signingSecret = requireEnv(slackConfig.signingSecretEnvVar);

      app = new App({
        token: botToken,
        appToken,
        signingSecret,
        socketMode: true,
      });

      webClient = new WebClient(botToken);

      // Listen for messages (DMs and channel mentions)
      app.message(async ({ message, context }) => {
        // Only handle standard user messages
        if (message.subtype !== undefined) return;
        if (!("text" in message) || !message.text) return;
        if (!("user" in message) || !message.user) return;

        const channelType = (message as { channel_type?: string }).channel_type ?? "channel";

        // Wrap external content for prompt injection protection
        const wrapped = wrapExternalContent(message.text, "slack");

        runtime.logger.info(
          `Received message from ${message.user} in ${message.channel}`,
        );

        await runtime.onMessage({
          channelId: message.channel,
          senderId: message.user,
          content: wrapped.content,
          threadId: ("thread_ts" in message ? message.thread_ts : undefined) as string | undefined,
          channel: "slack",
          timestamp: message.ts ? Number.parseFloat(message.ts) * 1000 : Date.now(),
          metadata: {
            sessionKey: deriveSessionKey(channelType, message.channel, message.user),
            botId: context.botId,
            channelType,
            promptInjectionWarnings: wrapped.warnings,
          },
        });
      });

      await app.start();
      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info("Slack channel connected via Socket Mode");
    },

    async stop(): Promise<void> {
      if (app) {
        await app.stop();
        app = null;
      }
      webClient = null;
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
      if (!webClient || !connected) {
        throw new Error("Slack channel is not connected");
      }

      const result = await webClient.chat.postMessage({
        channel: channelId,
        text: message.content,
        ...(message.threadId ? { thread_ts: message.threadId } : {}),
      });

      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error ?? "unknown"}`);
      }
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
