import * as net from "node:net";
import * as tls from "node:tls";
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
import { resolveIRCConfig, resolveEnv } from "./config.js";

/**
 * Derive a session key from an IRC context.
 * Channel messages use per-channel sessions; private messages use per-nick sessions.
 */
export function deriveIRCSessionKey(target: string): string {
  if (target.startsWith("#") || target.startsWith("&")) {
    return `irc:channel:${target}`;
  }
  return `irc:dm:${target}`;
}

/**
 * Parse an IRC PRIVMSG line into its components.
 * Format: `:nick!user@host PRIVMSG target :message`
 */
export function parsePrivmsg(
  line: string,
): { nick: string; target: string; message: string } | null {
  const match = line.match(
    /^:([^!]+)![^\s]+\s+PRIVMSG\s+(\S+)\s+:(.*)$/,
  );
  if (!match) return null;
  return {
    nick: match[1],
    target: match[2],
    message: match[3],
  };
}

/**
 * Check if a message mentions the bot's nick at the start.
 * Supports formats like "botnick: message" and "botnick, message".
 */
export function isNickMentioned(message: string, nick: string): boolean {
  const lower = message.toLowerCase();
  const nickLower = nick.toLowerCase();
  return (
    lower.startsWith(`${nickLower}:`) ||
    lower.startsWith(`${nickLower},`) ||
    lower.startsWith(`${nickLower} `)
  );
}

/**
 * Strip the nick prefix from a message.
 */
export function stripNickPrefix(message: string, nick: string): string {
  const nickLower = nick.toLowerCase();
  const lower = message.toLowerCase();
  if (
    lower.startsWith(`${nickLower}:`) ||
    lower.startsWith(`${nickLower},`)
  ) {
    return message.slice(nick.length + 1).trimStart();
  }
  if (lower.startsWith(`${nickLower} `)) {
    return message.slice(nick.length + 1).trimStart();
  }
  return message;
}

/**
 * Parse an IRC PING line and return the token.
 * Format: `PING :token`
 */
export function parsePing(line: string): string | null {
  const match = line.match(/^PING\s+:?(.+)$/);
  return match ? match[1] : null;
}

const RECONNECT_DELAY_MS = 5000;

/**
 * Create an IRC channel plugin using raw TCP/TLS sockets.
 */
export function createIRCChannel(): ChannelPlugin {
  let socket: net.Socket | tls.TLSSocket | null = null;
  let connected = false;
  let connectedSince: number | undefined;
  let lastError: string | undefined;
  let shouldReconnect = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let savedRuntime: ChannelRuntime | null = null;
  let savedConfig: ChannelConfig | null = null;
  let configuredNick = "";

  function sendRaw(line: string): void {
    if (socket && !socket.destroyed) {
      socket.write(`${line}\r\n`);
    }
  }

  function connectToServer(
    config: ChannelConfig,
    runtime: ChannelRuntime,
  ): void {
    const ircConfig = resolveIRCConfig(config.settings);
    configuredNick = ircConfig.nick;

    const onConnect = () => {
      // Authenticate if a password env var is configured
      if (ircConfig.passwordEnvVar) {
        const password = resolveEnv(ircConfig.passwordEnvVar);
        if (password) {
          sendRaw(`PASS ${password}`);
        }
      }

      sendRaw(`NICK ${ircConfig.nick}`);
      sendRaw(`USER ${ircConfig.nick} 0 * :Haya IRC Bot`);
    };

    if (ircConfig.tls) {
      socket = tls.connect(
        {
          host: ircConfig.server,
          port: ircConfig.port,
          rejectUnauthorized: false,
        },
        onConnect,
      );
    } else {
      socket = net.createConnection(
        { host: ircConfig.server, port: ircConfig.port },
        onConnect,
      );
    }

    let buffer = "";

    socket.setEncoding("utf8");

    socket.on("data", async (data: string) => {
      buffer += data;
      const lines = buffer.split("\r\n");
      // Keep the last incomplete fragment in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;

        // Handle PING/PONG keepalive
        const pingToken = parsePing(line);
        if (pingToken !== null) {
          sendRaw(`PONG :${pingToken}`);
          continue;
        }

        // Handle RPL_WELCOME (001) — join channels after registration
        if (line.match(/^\S+\s+001\s/)) {
          for (const ch of ircConfig.channels) {
            sendRaw(`JOIN ${ch}`);
          }
          connected = true;
          connectedSince = Date.now();
          lastError = undefined;
          runtime.logger.info("IRC channel connected and joined channels");
          continue;
        }

        // Handle PRIVMSG
        const msg = parsePrivmsg(line);
        if (!msg) continue;

        const isChannel =
          msg.target.startsWith("#") || msg.target.startsWith("&");
        const isDM = !isChannel;

        // In channels, only respond when nick is mentioned at start
        if (isChannel && !isNickMentioned(msg.message, ircConfig.nick)) {
          continue;
        }

        const text = isChannel
          ? stripNickPrefix(msg.message, ircConfig.nick)
          : msg.message;

        const { wrapped, suspiciousPatterns } = wrapExternalContent(text, "irc");

        const sessionTarget = isDM ? msg.nick : msg.target;

        runtime.logger.info(
          `Received message from ${msg.nick} in ${msg.target}`,
        );

        await runtime.onMessage({
          channelId: sessionTarget,
          senderId: msg.nick,
          senderName: msg.nick,
          content: wrapped,
          channel: "irc",
          timestamp: Date.now(),
          metadata: {
            sessionKey: deriveIRCSessionKey(sessionTarget),
            isChannel,
            rawTarget: msg.target,
            promptInjectionWarnings: suspiciousPatterns,
          },
        });
      }
    });

    socket.on("error", (err) => {
      lastError = err.message;
      runtime.logger.warn(`IRC socket error: ${err.message}`);
    });

    socket.on("close", () => {
      connected = false;
      connectedSince = undefined;
      runtime.logger.info("IRC connection closed");

      if (shouldReconnect) {
        runtime.logger.info(
          `Reconnecting to IRC in ${RECONNECT_DELAY_MS / 1000}s...`,
        );
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (shouldReconnect && savedConfig && savedRuntime) {
            connectToServer(savedConfig, savedRuntime);
          }
        }, RECONNECT_DELAY_MS);
      }
    });
  }

  return {
    id: "irc",
    name: "IRC",
    capabilities: {
      chatTypes: ["text"],
      threads: false,
      reactions: false,
      media: false,
    } satisfies ChannelCapabilities,

    async start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void> {
      savedRuntime = runtime;
      savedConfig = config;
      shouldReconnect = true;
      connectToServer(config, runtime);
    },

    async stop(): Promise<void> {
      shouldReconnect = false;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (socket && !socket.destroyed) {
        sendRaw("QUIT :Goodbye");
        await new Promise<void>((resolve) => {
          socket!.once("close", () => resolve());
          socket!.end();
          // Force-close after 2 seconds if graceful shutdown doesn't complete
          setTimeout(() => {
            if (socket && !socket.destroyed) {
              socket.destroy();
            }
            resolve();
          }, 2000);
        });
      }

      socket = null;
      connected = false;
      connectedSince = undefined;
      savedRuntime = null;
      savedConfig = null;
    },

    status(): ChannelStatus {
      return {
        connected,
        connectedSince,
        error: lastError,
      };
    },

    async sendMessage(channelId: string, message: OutboundMessage): Promise<void> {
      if (!socket || !connected) {
        throw new Error("IRC channel is not connected");
      }

      // IRC messages have a max length of 512 bytes including CRLF.
      // Split long messages into multiple PRIVMSG lines.
      const maxLen = 400; // conservative limit for the message portion
      const lines = message.content.split("\n");

      for (const line of lines) {
        if (line.length <= maxLen) {
          sendRaw(`PRIVMSG ${channelId} :${line}`);
        } else {
          // Split long lines into chunks
          for (let i = 0; i < line.length; i += maxLen) {
            sendRaw(`PRIVMSG ${channelId} :${line.slice(i, i + maxLen)}`);
          }
        }
      }
    },
  };
}

/**
 * IRC plugin definition for use with the Haya plugin system.
 */
export default definePlugin({
  id: "irc",
  name: "IRC Channel",
  version: "0.1.0",
  permissions: {
    network: true,
  },
  register(api) {
    api.logger.info("IRC channel plugin registered");
  },
});
