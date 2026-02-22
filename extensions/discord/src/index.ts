import {
  Client,
  GatewayIntentBits,
  Partials,
  type TextChannel,
  type DMChannel,
  type Message,
} from "discord.js";
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
import { resolveDiscordConfig, requireEnv } from "./config.js";

/**
 * Derive a session key from a Discord message context.
 * DM messages use per-user sessions; guild messages use per-channel sessions.
 */
export function deriveDiscordSessionKey(
  isDM: boolean,
  channelId: string,
  userId: string,
): string {
  if (isDM) {
    return `discord:dm:${userId}`;
  }
  return `discord:channel:${channelId}`;
}

/**
 * Create a Discord channel plugin using discord.js v14.
 */
export function createDiscordChannel(): ChannelPlugin {
  let client: Client | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;

  return {
    id: "discord",
    name: "Discord",
    capabilities: {
      chatTypes: ["text"],
      threads: true,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const discordConfig = resolveDiscordConfig(config.settings);
      const botToken = requireEnv(discordConfig.botTokenEnvVar);

      client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
      });

      client.on("messageCreate", async (message: Message) => {
        // Skip bot messages
        if (message.author.bot) return;

        const isDM = message.channel.isDMBased();
        const content = message.content;
        if (!content) return;

        const { wrapped, suspiciousPatterns } = wrapExternalContent(content, "discord");

        runtime.logger.info(
          `Received message from ${message.author.id} in ${message.channelId}`,
        );

        await runtime.onMessage({
          channelId: message.channelId,
          senderId: message.author.id,
          senderName: message.author.username,
          content: wrapped,
          threadId: message.reference?.messageId ?? undefined,
          channel: "discord",
          timestamp: message.createdTimestamp,
          metadata: {
            sessionKey: deriveDiscordSessionKey(isDM, message.channelId, message.author.id),
            guildId: message.guildId,
            isDM,
            promptInjectionWarnings: suspiciousPatterns,
          },
        });
      });

      await client.login(botToken);
      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info("Discord channel connected");
    },

    async stop(): Promise<void> {
      if (client) {
        client.destroy();
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
        throw new Error("Discord channel is not connected");
      }

      const channel = await client.channels.fetch(channelId);
      if (!channel || !("send" in channel)) {
        throw new Error(`Cannot send message to channel ${channelId}`);
      }

      const textChannel = channel as TextChannel | DMChannel;

      if (message.threadId) {
        const referenced = await textChannel.messages.fetch(message.threadId);
        await referenced.reply(message.content);
      } else {
        await textChannel.send(message.content);
      }
    },
  };
}

/**
 * Discord plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "discord",
  name: "Discord Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Discord channel plugin registered");
  },
});
