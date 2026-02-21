import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type Activity,
  type ConversationReference,
  type TurnContext,
} from "botbuilder";
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
import { resolveTeamsConfig, requireEnv } from "./config.js";
import http from "node:http";

/**
 * Derive a session key from a Teams message context.
 * Personal (DM) chats use per-user sessions; channel/group chats use per-conversation sessions.
 */
export function deriveTeamsSessionKey(
  conversationType: string,
  conversationId: string,
  userId: string,
): string {
  if (conversationType === "personal") {
    return `teams:dm:${userId}`;
  }
  return `teams:channel:${conversationId}`;
}

/**
 * Create a Microsoft Teams channel plugin using the Bot Framework SDK.
 */
export function createTeamsChannel(): ChannelPlugin {
  let adapter: CloudAdapter | null = null;
  let server: http.Server | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;

  return {
    id: "teams",
    name: "Microsoft Teams",
    capabilities: {
      chatTypes: ["text"],
      threads: true,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const teamsConfig = resolveTeamsConfig(config.settings);
      const appId = requireEnv(teamsConfig.appIdEnvVar);
      const appPassword = requireEnv(teamsConfig.appPasswordEnvVar);
      const tenantId = requireEnv(teamsConfig.tenantIdEnvVar);

      const botAuth = new ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: appId,
        MicrosoftAppPassword: appPassword,
        MicrosoftAppTenantId: tenantId,
        MicrosoftAppType: "SingleTenant",
      });

      adapter = new CloudAdapter(botAuth);

      adapter.onTurnError = async (_context: TurnContext, error: Error) => {
        lastError = error.message;
        runtime.logger.error(`Teams adapter error: ${error.message}`);
      };

      const port = Number(config.settings.port ?? 3978);

      server = http.createServer(async (req, res) => {
        if (req.method === "POST" && req.url === "/api/messages") {
          await adapter!.process(req, res, async (context: TurnContext) => {
            const activity = context.activity;

            // Only handle message activities with text content
            if (activity.type !== "message") return;
            if (!activity.text) return;
            if (!activity.from?.id) return;

            const conversationType =
              activity.conversation?.conversationType ?? "channel";

            // Wrap external content for prompt injection protection
            const wrapped = wrapExternalContent(activity.text, "teams");

            runtime.logger.info(
              `Received message from ${activity.from.id} in ${activity.conversation?.id}`,
            );

            await runtime.onMessage({
              channelId: activity.conversation?.id ?? "",
              senderId: activity.from.id,
              senderName: activity.from.name,
              content: wrapped.text,
              threadId: activity.conversation?.id,
              channel: "teams",
              timestamp: activity.timestamp
                ? new Date(activity.timestamp as unknown as string).getTime()
                : Date.now(),
              metadata: {
                sessionKey: deriveTeamsSessionKey(
                  conversationType,
                  activity.conversation?.id ?? "",
                  activity.from.id,
                ),
                conversationType,
                tenantId: activity.conversation?.tenantId,
                promptInjectionWarnings: wrapped.suspiciousPatterns,
              },
            });
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => {
        server!.listen(port, () => {
          connected = true;
          connectedSince = Date.now();
          lastError = undefined;
          runtime.logger.info(
            `Teams channel listening on port ${port} at /api/messages`,
          );
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((err) => (err ? reject(err) : resolve()));
        });
        server = null;
      }
      adapter = null;
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
      if (!adapter || !connected) {
        throw new Error("Teams channel is not connected");
      }

      const conversationRef: Partial<ConversationReference> = {
        conversation: { id: channelId, isGroup: false, conversationType: "personal", tenantId: "", name: "" },
        serviceUrl: "",
      };

      await adapter.continueConversationAsync(
        "",
        conversationRef as ConversationReference,
        async (context: TurnContext) => {
          await context.sendActivity({ type: "message", text: message.content } as Partial<Activity>);
        },
      );
    },
  };
}

/**
 * Teams plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "teams",
  name: "Microsoft Teams Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Microsoft Teams channel plugin registered");
  },
});
