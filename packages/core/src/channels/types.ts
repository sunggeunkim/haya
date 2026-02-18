import type { Logger } from "tslog";

/**
 * Channel capabilities descriptor. Describes what features the channel supports.
 */
export interface ChannelCapabilities {
  /** Supported message types (e.g., "text", "rich", "block") */
  chatTypes: string[];
  /** Whether the channel supports threaded conversations */
  threads?: boolean;
  /** Whether the channel supports reactions */
  reactions?: boolean;
  /** Whether the channel supports media/file attachments */
  media?: boolean;
}

/**
 * Configuration passed to a channel plugin on start.
 */
export interface ChannelConfig {
  /** Channel-specific settings (from config file) */
  settings: Record<string, unknown>;
}

/**
 * Runtime services provided to a channel plugin by the host.
 */
export interface ChannelRuntime {
  /** Callback to deliver inbound messages to the agent runtime */
  onMessage: (msg: InboundMessage) => Promise<void>;
  /** Scoped logger for this channel */
  logger: Logger<unknown>;
}

/**
 * Channel plugin interface. Channels represent messaging integrations
 * (Slack, Discord, Telegram, etc.) that connect external services
 * to the Haya AI assistant.
 */
export interface ChannelPlugin {
  /** Unique channel identifier (e.g., "slack", "discord", "telegram") */
  readonly id: string;
  /** Human-readable channel name */
  readonly name: string;
  /** Channel capabilities */
  readonly capabilities: ChannelCapabilities;

  /** Start the channel (connect to external service, begin listening) */
  start(config: ChannelConfig, runtime: ChannelRuntime): Promise<void>;
  /** Stop the channel (disconnect, clean up resources) */
  stop(): Promise<void>;
  /** Get current channel status */
  status(): ChannelStatus;

  /** Send a message to the channel */
  sendMessage(channelId: string, message: OutboundMessage): Promise<void>;
}

export interface ChannelStatus {
  connected: boolean;
  error?: string;
  /** Timestamp when connection was established */
  connectedSince?: number;
  /** Additional status details */
  details?: Record<string, unknown>;
}

export interface InboundMessage {
  /** The channel target (e.g., Slack channel ID, DM ID) */
  channelId: string;
  /** Sender's platform-specific ID */
  senderId: string;
  /** Sender's display name */
  senderName?: string;
  /** Message content */
  content: string;
  /** Thread ID if message is in a thread */
  threadId?: string;
  /** Channel plugin identifier (e.g., "slack", "discord") */
  channel: string;
  /** Timestamp of message */
  timestamp: number;
  /** Additional platform-specific metadata */
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  /** Message content */
  content: string;
  /** Thread ID to reply in a thread */
  threadId?: string;
}

/**
 * Handler called when a channel receives an inbound message.
 */
export type ChannelMessageHandler = (
  message: InboundMessage,
) => void | Promise<void>;
