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
import { resolveWebhookConfig, requireEnv } from "./config.js";
import type { WebhookConfig, WebhookSource } from "./config.js";
import { verifyHmacSignature } from "./hmac.js";

/**
 * Read the full body from an incoming HTTP request, enforcing a size limit.
 */
function readBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    req.on("data", (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > maxBytes) {
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

/**
 * Attempt to match a request signature against configured webhook sources.
 * Returns the matched source name, or null if no match.
 */
function matchSource(
  payload: string,
  signatureHeader: string | undefined,
  sources: WebhookSource[],
): string | null {
  if (!signatureHeader || sources.length === 0) {
    return null;
  }

  for (const source of sources) {
    const secret = process.env[source.secretEnvVar];
    if (!secret) continue;

    if (verifyHmacSignature(payload, signatureHeader, secret)) {
      return source.name;
    }
  }

  return null;
}

/**
 * Create a Webhook channel plugin that receives inbound messages via HTTP POST.
 */
export function createWebhookChannel(): ChannelPlugin {
  let server: http.Server | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;

  return {
    id: "webhook",
    name: "Webhook",
    capabilities: {
      chatTypes: ["text"],
      threads: false,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const webhookConfig = resolveWebhookConfig(config.settings);

      server = http.createServer(async (req, res) => {
        // Only accept POST to the configured path
        if (req.method !== "POST" || req.url !== webhookConfig.path) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        try {
          const body = await readBody(req, webhookConfig.maxPayloadBytes);

          // Validate HMAC signature if sources are configured
          const signatureHeader = req.headers["x-hub-signature-256"] as
            | string
            | undefined;

          if (webhookConfig.sources.length > 0) {
            const matchedSource = matchSource(
              body,
              signatureHeader,
              webhookConfig.sources,
            );

            if (!matchedSource) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid signature" }));
              return;
            }

            await handleWebhookPayload(body, matchedSource, webhookConfig, runtime);
          } else {
            await handleWebhookPayload(body, "unknown", webhookConfig, runtime);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Internal server error";

          if (message === "Payload too large") {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: message }));
          } else {
            runtime.logger.error(`Webhook error: ${message}`);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
      });

      await new Promise<void>((resolve) => {
        server!.listen(webhookConfig.port, () => {
          resolve();
        });
      });

      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info(
        `Webhook channel listening on port ${webhookConfig.port} at ${webhookConfig.path}`,
      );
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

    async sendMessage(_channelId: string, _message: OutboundMessage): Promise<void> {
      throw new Error("Webhook channel does not support outbound messages");
    },
  };
}

/**
 * Parse and handle an incoming webhook payload.
 */
async function handleWebhookPayload(
  body: string,
  sourceName: string,
  _config: WebhookConfig,
  runtime: ChannelRuntime,
): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = {};
  }

  const rawContent =
    typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed);
  const senderId =
    typeof parsed.senderId === "string" ? parsed.senderId : "webhook";
  const source =
    typeof parsed.source === "string" ? parsed.source : sourceName;

  const { wrapped, suspiciousPatterns } = wrapExternalContent(rawContent, "webhook");

  runtime.logger.info(`Received webhook from source: ${source}`);

  await runtime.onMessage({
    channelId: source,
    senderId,
    content: wrapped,
    channel: "webhook",
    timestamp: Date.now(),
    metadata: {
      sessionKey: `webhook:${source}`,
      source,
      promptInjectionWarnings: suspiciousPatterns,
    },
  });
}

/**
 * Webhook plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "webhook",
  name: "Webhook Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Webhook channel plugin registered");
  },
});
