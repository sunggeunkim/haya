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
import { resolveSignalConfig, requireEnv } from "./config.js";

/**
 * Derive a session key from a Signal message context.
 * Direct messages use per-phone sessions; group chats use per-group sessions.
 */
export function deriveSignalSessionKey(
  phoneNumber?: string,
  groupId?: string,
): string {
  if (groupId) {
    return `signal:group:${groupId}`;
  }
  return `signal:dm:${phoneNumber}`;
}

/** JSON-RPC request envelope for signal-cli daemon */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: number;
}

/** JSON-RPC response envelope from signal-cli daemon */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: { code: number; message: string };
  id: number;
}

/** Envelope structure returned by signal-cli `receive` method */
interface SignalEnvelope {
  source?: string;
  sourceNumber?: string;
  sourceName?: string;
  dataMessage?: {
    message?: string;
    timestamp?: number;
    groupInfo?: {
      groupId?: string;
    };
  };
}

let nextRpcId = 1;

/**
 * Send a JSON-RPC request to the signal-cli daemon.
 */
async function sendJsonRpc(
  url: string,
  method: string,
  params: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const body: JsonRpcRequest = {
    jsonrpc: "2.0",
    method,
    params,
    id: nextRpcId++,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `signal-cli JSON-RPC error: HTTP ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as JsonRpcResponse;
}

/**
 * Create a Signal channel plugin using signal-cli JSON-RPC daemon.
 */
export function createSignalChannel(): ChannelPlugin {
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;
  let jsonRpcUrl = "";
  let registeredNumber = "";

  return {
    id: "signal",
    name: "Signal",
    capabilities: {
      chatTypes: ["text"],
      threads: false,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      const signalConfig = resolveSignalConfig(config.settings);
      jsonRpcUrl = signalConfig.jsonRpcUrl;
      registeredNumber = requireEnv(signalConfig.registeredNumberEnvVar);

      // Verify connectivity by calling version
      const versionResp = await sendJsonRpc(jsonRpcUrl, "version", {});
      if (versionResp.error) {
        throw new Error(
          `Failed to connect to signal-cli daemon: ${versionResp.error.message}`,
        );
      }

      // Start polling for incoming messages
      pollTimer = setInterval(async () => {
        try {
          const resp = await sendJsonRpc(jsonRpcUrl, "receive", {
            account: registeredNumber,
          });

          if (resp.error) {
            lastError = resp.error.message;
            runtime.logger.warn(`Signal receive error: ${resp.error.message}`);
            return;
          }

          const envelopes = (resp.result ?? []) as SignalEnvelope[];

          for (const envelope of envelopes) {
            if (!envelope.dataMessage?.message) continue;

            const text = envelope.dataMessage.message;
            const senderPhone = envelope.sourceNumber ?? envelope.source ?? "unknown";
            const senderName = envelope.sourceName ?? senderPhone;
            const groupId = envelope.dataMessage.groupInfo?.groupId;
            const timestamp = envelope.dataMessage.timestamp ?? Date.now();

            const { wrapped, suspiciousPatterns } = wrapExternalContent(text, "signal");

            runtime.logger.info(
              `Received message from ${senderPhone}${groupId ? ` in group ${groupId}` : ""}`,
            );

            await runtime.onMessage({
              channelId: groupId ?? senderPhone,
              senderId: senderPhone,
              senderName,
              content: wrapped,
              channel: "signal",
              timestamp,
              metadata: {
                sessionKey: deriveSignalSessionKey(senderPhone, groupId),
                isGroup: !!groupId,
                promptInjectionWarnings: suspiciousPatterns,
              },
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastError = msg;
          runtime.logger.warn(`Signal poll error: ${msg}`);
        }
      }, 2000);

      connected = true;
      connectedSince = Date.now();
      lastError = undefined;
      runtime.logger.info("Signal channel connected via JSON-RPC polling");
    },

    async stop(): Promise<void> {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
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
        throw new Error("Signal channel is not connected");
      }

      // Determine whether the target is a group or a direct message
      const isGroup = channelId.length > 20; // group IDs are base64-encoded, much longer than phone numbers

      const params: Record<string, unknown> = {
        account: registeredNumber,
        message: message.content,
      };

      if (isGroup) {
        params.groupId = channelId;
      } else {
        params.recipients = [channelId];
      }

      const resp = await sendJsonRpc(jsonRpcUrl, "send", params);

      if (resp.error) {
        throw new Error(`Signal send error: ${resp.error.message}`);
      }
    },
  };
}

/**
 * Signal plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "signal",
  name: "Signal Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("Signal channel plugin registered");
  },
});
