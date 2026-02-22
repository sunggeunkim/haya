import { Bot } from "grammy";
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
import { resolveTelegramConfig, requireEnv } from "./config.js";

/**
 * Derive a session key from a Telegram message context.
 * Private chats use per-user sessions; group/supergroup chats use per-group sessions.
 */
export function deriveTelegramSessionKey(
  chatType: string,
  chatId: number,
  userId: number,
): string {
  if (chatType === "private") {
    return `telegram:dm:${userId}`;
  }
  return `telegram:group:${chatId}`;
}

/**
 * Create a Telegram channel plugin using grammy.
 */
export function createTelegramChannel(): ChannelPlugin {
  let bot: Bot | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;

  return {
    id: "telegram",
    name: "Telegram",
    capabilities: {
      chatTypes: ["text"],
      threads: true,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const telegramConfig = resolveTelegramConfig(config.settings);
      const botToken = requireEnv(telegramConfig.botTokenEnvVar);

      bot = new Bot(botToken);

      bot.on("message:text", async (ctx) => {
        const text = ctx.message.text;
        const userId = ctx.from.id;
        const chatId = ctx.chat.id;
        const chatType = ctx.chat.type;

        const { wrapped, suspiciousPatterns } = wrapExternalContent(text, "telegram");

        runtime.logger.info(
          `Received message from ${userId} in chat ${chatId}`,
        );

        await runtime.onMessage({
          channelId: String(chatId),
          senderId: String(userId),
          senderName: ctx.from.username ?? ctx.from.first_name,
          content: wrapped,
          threadId: ctx.message.reply_to_message
            ? String(ctx.message.reply_to_message.message_id)
            : undefined,
          channel: "telegram",
          timestamp: ctx.message.date * 1000,
          metadata: {
            sessionKey: deriveTelegramSessionKey(chatType, chatId, userId),
            chatType,
            promptInjectionWarnings: suspiciousPatterns,
          },
        });
      });

      // Start long polling (non-blocking)
      bot.start();
      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info("Telegram channel connected via long polling");
    },

    async stop(): Promise<void> {
      if (bot) {
        await bot.stop();
        bot = null;
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
      if (!bot || !connected) {
        throw new Error("Telegram channel is not connected");
      }

      await bot.api.sendMessage(channelId, message.content, {
        ...(message.threadId
          ? { reply_to_message_id: Number(message.threadId) }
          : {}),
      });
    },
  };
}

/**
 * Telegram plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "telegram",
  name: "Telegram Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Telegram channel plugin registered");
  },
});
