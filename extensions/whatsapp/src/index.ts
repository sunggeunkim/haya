import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
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
import { resolveWhatsAppConfig, requireEnv } from "./config.js";

/**
 * Derive a session key from a WhatsApp message context.
 * WhatsApp is always DM-based (no group concept in the Cloud API for bots).
 */
export function deriveSessionKey(userId: string): string {
  return `whatsapp:dm:${userId}`;
}

/**
 * Read the full request body, enforcing a maximum size limit.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", reject);
  });
}

interface WhatsAppWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value: {
        messaging_product: string;
        metadata: { phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }>;
      };
      field: string;
    }>;
  }>;
}

/**
 * Create a WhatsApp Cloud API channel plugin.
 */
export function createWhatsAppChannel(): ChannelPlugin {
  let server: Server | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;

  return {
    id: "whatsapp",
    name: "WhatsApp",
    capabilities: {
      chatTypes: ["text"],
      threads: false,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(
      config: ChannelConfig,
      runtime: ChannelRuntime,
    ): Promise<void> {
      const waConfig = resolveWhatsAppConfig(config.settings);

      server = createServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          const url = req.url ?? "";

          // Webhook verification (GET)
          if (req.method === "GET" && url.startsWith(waConfig.webhookPath)) {
            const params = new URL(
              url,
              `http://${req.headers.host ?? "localhost"}`,
            ).searchParams;
            const mode = params.get("hub.mode");
            const token = params.get("hub.verify_token");
            const challenge = params.get("hub.challenge");

            if (
              mode === "subscribe" &&
              token === waConfig.verifyToken &&
              challenge
            ) {
              res.writeHead(200, { "Content-Type": "text/plain" });
              res.end(challenge);
              return;
            }

            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Verification failed" }));
            return;
          }

          // Incoming messages (POST)
          if (req.method === "POST" && url.startsWith(waConfig.webhookPath)) {
            let body: string;
            try {
              body = await readBody(req, 1_048_576); // 1MB max
            } catch {
              res.writeHead(413, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Payload too large" }));
              return;
            }

            // Always respond 200 to WhatsApp quickly
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));

            try {
              const payload = JSON.parse(body) as WhatsAppWebhookPayload;

              if (payload.object !== "whatsapp_business_account") return;

              for (const entry of payload.entry ?? []) {
                for (const change of entry.changes ?? []) {
                  if (change.field !== "messages") continue;

                  const contacts = change.value.contacts ?? [];
                  const messages = change.value.messages ?? [];

                  for (const msg of messages) {
                    if (msg.type !== "text" || !msg.text?.body) continue;

                    const contact = contacts.find(
                      (c) => c.wa_id === msg.from,
                    );

                    const { suspiciousPatterns } = wrapExternalContent(
                      msg.text.body,
                      "whatsapp",
                    );

                    runtime.logger.info(
                      `Received message from ${msg.from}`,
                    );

                    await runtime.onMessage({
                      channelId: msg.from,
                      senderId: msg.from,
                      senderName: contact?.profile.name,
                      content: msg.text.body,
                      channel: "whatsapp",
                      timestamp: Number(msg.timestamp) * 1000,
                      metadata: {
                        sessionKey: deriveSessionKey(msg.from),
                        channelType: "private",
                        messageId: msg.id,
                        promptInjectionWarnings: suspiciousPatterns,
                      },
                    });
                  }
                }
              }
            } catch (err) {
              runtime.logger.warn(
                `Failed to process WhatsApp webhook: ${err}`,
              );
            }

            return;
          }

          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        },
      );

      await new Promise<void>((resolve, reject) => {
        server!.listen(waConfig.port, () => {
          connected = true;
          connectedSince = Date.now();
          lastError = undefined;
          runtime.logger.info(
            `WhatsApp channel listening on port ${waConfig.port}`,
          );
          resolve();
        });
        server!.on("error", reject);
      });
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

    async sendMessage(
      channelId: string,
      message: OutboundMessage,
    ): Promise<void> {
      if (!connected) {
        throw new Error("WhatsApp channel is not connected");
      }

      const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");

      // Use the WhatsApp Cloud API to send text messages
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: channelId,
            type: "text",
            text: { body: message.content },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `WhatsApp API error: HTTP ${response.status} - ${errorBody}`,
        );
      }
    },
  };
}

/**
 * WhatsApp plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "whatsapp",
  name: "WhatsApp Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("WhatsApp channel plugin registered");
  },
});
