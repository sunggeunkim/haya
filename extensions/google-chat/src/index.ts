import * as http from "node:http";
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
import { resolveGoogleChatConfig, requireEnv } from "./config.js";

/**
 * Derive a session key from a Google Chat space name.
 * All messages within a space share the same session.
 */
export function deriveGoogleChatSessionKey(spaceName: string): string {
  // spaceName is like "spaces/AAAA_BBB", extract the space ID
  const spaceId = spaceName.replace(/^spaces\//, "");
  return `google-chat:space:${spaceId}`;
}

/**
 * Verify the Authorization Bearer token from incoming Google Chat webhook requests.
 */
export function verifyBearerToken(
  authHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!authHeader) return false;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return false;
  return parts[1] === expectedToken;
}

/** Google Chat incoming event structure (simplified) */
interface GoogleChatEvent {
  type?: string;
  eventTime?: string;
  message?: {
    name?: string;
    text?: string;
    thread?: {
      name?: string;
    };
    sender?: {
      name?: string;
      displayName?: string;
      type?: string;
    };
    space?: {
      name?: string;
      type?: string;
    };
    createTime?: string;
  };
}

/**
 * Parse the incoming Google Chat event JSON body from the webhook request.
 */
export function parseGoogleChatEvent(body: string): GoogleChatEvent | null {
  try {
    return JSON.parse(body) as GoogleChatEvent;
  } catch {
    return null;
  }
}

/**
 * Create a Google Chat channel plugin using HTTP webhook receiver.
 */
export function createGoogleChatChannel(): ChannelPlugin {
  let server: http.Server | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;

  return {
    id: "google-chat",
    name: "Google Chat",
    capabilities: {
      chatTypes: ["text"],
      threads: true,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const chatConfig = resolveGoogleChatConfig(config.settings);
      const verifyToken = requireEnv(chatConfig.verifyTokenEnvVar);

      server = http.createServer(async (req, res) => {
        // Only accept POST requests
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        // Verify Bearer token
        if (!verifyBearerToken(req.headers.authorization, verifyToken)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }

        // Read request body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const body = Buffer.concat(chunks).toString("utf8");

        const event = parseGoogleChatEvent(body);
        if (!event) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        // Only process MESSAGE events with text content
        if (event.type !== "MESSAGE" || !event.message?.text) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({}));
          return;
        }

        const text = event.message.text;
        const spaceName = event.message.space?.name ?? "unknown";
        const senderName = event.message.sender?.displayName ?? "Unknown";
        const senderId = event.message.sender?.name ?? "unknown";
        const threadName = event.message.thread?.name;
        const timestamp = event.message.createTime
          ? new Date(event.message.createTime).getTime()
          : Date.now();

        const { wrapped, suspiciousPatterns } = wrapExternalContent(text, "google-chat");

        runtime.logger.info(
          `Received message from ${senderName} in space ${spaceName}`,
        );

        await runtime.onMessage({
          channelId: spaceName,
          senderId,
          senderName,
          content: wrapped,
          threadId: threadName,
          channel: "google-chat",
          timestamp,
          metadata: {
            sessionKey: deriveGoogleChatSessionKey(spaceName),
            spaceType: event.message.space?.type,
            promptInjectionWarnings: suspiciousPatterns,
          },
        });

        // Respond with 200 to acknowledge receipt
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
      });

      await new Promise<void>((resolve, reject) => {
        server!.listen(chatConfig.webhookPort, () => {
          resolve();
        });
        server!.on("error", (err) => {
          reject(err);
        });
      });

      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info(
        `Google Chat channel listening on port ${chatConfig.webhookPort}`,
      );
    },

    async stop(): Promise<void> {
      if (server) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
        server = null;
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
      if (!connected) {
        throw new Error("Google Chat channel is not connected");
      }

      // Build the REST API URL for sending messages to a space
      const url = `https://chat.googleapis.com/v1/${channelId}/messages`;

      const body: Record<string, unknown> = {
        text: message.content,
      };

      if (message.threadId) {
        body.thread = { name: message.threadId };
        body.messageReplyOption = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD";
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_TOKEN ?? ""}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(
          `Google Chat API error: HTTP ${response.status} ${response.statusText}`,
        );
      }
    },
  };
}

/**
 * Google Chat plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "google-chat",
  name: "Google Chat Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Google Chat channel plugin registered");
  },
});
