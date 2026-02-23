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
import { resolveKakaoConfig } from "./config.js";

/** Maximum character length for a single Kakao simpleText output. */
const KAKAO_TEXT_LIMIT = 1000;

/** Maximum number of outputs per Kakao response. */
const KAKAO_MAX_OUTPUTS = 3;

/** Callback URL expiry in milliseconds (Kakao allows 1 minute; we purge at 55s). */
const CALLBACK_EXPIRY_MS = 55_000;

interface PendingCallback {
  callbackUrl: string;
  createdAt: number;
}

/**
 * Kakao i Open Builder skill payload shape.
 * @see https://i.kakao.com/docs/skill-response-format
 */
interface KakaoSkillPayload {
  intent?: { id?: string; name?: string };
  userRequest?: {
    timezone?: string;
    utterance?: string;
    lang?: string;
    user?: { id?: string; type?: string; properties?: Record<string, unknown> };
    callbackUrl?: string;
  };
  bot?: { id?: string; name?: string };
  action?: { name?: string; params?: Record<string, unknown> };
}

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
 * Split a long message into chunks that fit within Kakao's simpleText limit.
 * Returns at most {@link KAKAO_MAX_OUTPUTS} chunks.
 */
export function chunkMessage(text: string): string[] {
  if (text.length <= KAKAO_TEXT_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0 && chunks.length < KAKAO_MAX_OUTPUTS) {
    if (remaining.length <= KAKAO_TEXT_LIMIT) {
      chunks.push(remaining);
      break;
    }

    // Try to split at the last newline within the limit
    let splitAt = remaining.lastIndexOf("\n", KAKAO_TEXT_LIMIT);
    if (splitAt <= 0) {
      // Fall back to splitting at the last space
      splitAt = remaining.lastIndexOf(" ", KAKAO_TEXT_LIMIT);
    }
    if (splitAt <= 0) {
      // Hard split at the limit
      splitAt = KAKAO_TEXT_LIMIT;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  // If there's leftover text that didn't fit, append ellipsis to the last chunk
  if (remaining.length > 0 && chunks.length > 0) {
    const last = chunks[chunks.length - 1];
    if (last.length + 4 <= KAKAO_TEXT_LIMIT) {
      chunks[chunks.length - 1] = last + "\n...";
    }
  }

  return chunks;
}

/**
 * Build a Kakao skill callback response body with simpleText outputs.
 */
export function buildCallbackBody(
  chunks: string[],
): Record<string, unknown> {
  return {
    version: "2.0",
    template: {
      outputs: chunks.map((text) => ({
        simpleText: { text },
      })),
    },
  };
}

/**
 * Create a KakaoTalk channel plugin that receives inbound messages via
 * Kakao i Open Builder's skill server webhook and replies through callback URLs.
 */
export function createKakaoChannel(): ChannelPlugin {
  let server: http.Server | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  const pendingCallbacks = new Map<string, PendingCallback>();

  /** Remove expired callback entries. */
  function purgeExpiredCallbacks(): void {
    const now = Date.now();
    for (const [key, entry] of pendingCallbacks) {
      if (now - entry.createdAt > CALLBACK_EXPIRY_MS) {
        pendingCallbacks.delete(key);
      }
    }
  }

  return {
    id: "kakao",
    name: "KakaoTalk",
    capabilities: {
      chatTypes: ["text"],
      threads: false,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const kakaoConfig = resolveKakaoConfig(config.settings);

      server = http.createServer(async (req, res) => {
        // Only accept POST to the configured path
        if (req.method !== "POST" || req.url !== kakaoConfig.path) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        try {
          const body = await readBody(req, kakaoConfig.maxPayloadBytes);

          let payload: KakaoSkillPayload;
          try {
            payload = JSON.parse(body) as KakaoSkillPayload;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          const utterance = payload.userRequest?.utterance;
          const botUserKey = payload.userRequest?.user?.id;
          const callbackUrl = payload.userRequest?.callbackUrl;

          if (!utterance || !botUserKey) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "Missing userRequest.utterance or userRequest.user.id" }),
            );
            return;
          }

          // Store the one-time callback URL for this user
          if (callbackUrl) {
            pendingCallbacks.set(botUserKey, {
              callbackUrl,
              createdAt: Date.now(),
            });
          }

          const { text: wrapped, suspiciousPatterns } = wrapExternalContent(
            utterance,
            "kakao",
          );

          runtime.logger.info(
            `Received KakaoTalk message from user ${botUserKey}`,
          );

          // Deliver to agent runtime (non-blocking — we respond immediately)
          runtime.onMessage({
            channelId: botUserKey,
            senderId: botUserKey,
            content: wrapped,
            channel: "kakao",
            timestamp: Date.now(),
            metadata: {
              sessionKey: `kakao:user:${botUserKey}`,
              promptInjectionWarnings: suspiciousPatterns,
            },
          }).catch((err) => {
            runtime.logger.error(
              `Error processing KakaoTalk message: ${err instanceof Error ? err.message : String(err)}`,
            );
          });

          // Respond immediately with callback-deferred format
          if (callbackUrl) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                version: "2.0",
                useCallback: true,
                data: { text: "잠시만 기다려주세요..." },
              }),
            );
          } else {
            // No callback URL — respond with a simple acknowledgment
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                version: "2.0",
                template: {
                  outputs: [
                    { simpleText: { text: "메시지를 받았습니다." } },
                  ],
                },
              }),
            );
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Internal server error";

          if (message === "Payload too large") {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: message }));
          } else {
            runtime.logger.error(`KakaoTalk skill server error: ${message}`);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
      });

      await new Promise<void>((resolve) => {
        server!.listen(kakaoConfig.port, () => {
          resolve();
        });
      });

      // Start periodic cleanup of expired callbacks
      cleanupTimer = setInterval(purgeExpiredCallbacks, 10_000);

      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info(
        `KakaoTalk skill server listening on port ${kakaoConfig.port} at ${kakaoConfig.path}`,
      );
    },

    async stop(): Promise<void> {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        server = null;
      }
      pendingCallbacks.clear();
      connected = false;
      connectedSince = undefined;
    },

    status(): ChannelStatus {
      return {
        connected,
        connectedSince,
        error: lastError,
        details: {
          pendingCallbacks: pendingCallbacks.size,
        },
      };
    },

    async sendMessage(channelId: string, message: OutboundMessage): Promise<void> {
      const entry = pendingCallbacks.get(channelId);
      if (!entry) {
        // No pending callback — the URL may have expired or was never provided
        lastError = `No pending callback for user ${channelId}`;
        return;
      }

      // Remove the one-time callback entry
      pendingCallbacks.delete(channelId);

      const chunks = chunkMessage(message.content);
      const body = buildCallbackBody(chunks);

      const response = await fetch(entry.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        lastError = `Callback POST failed: ${response.status} ${response.statusText}`;
        throw new Error(lastError);
      }
    },
  };
}

/**
 * KakaoTalk plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "kakao",
  name: "KakaoTalk Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("KakaoTalk channel plugin registered");
  },
});
