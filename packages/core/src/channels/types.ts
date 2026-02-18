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

  /** Start the channel (connect to external service, begin listening) */
  start(): Promise<void>;
  /** Stop the channel (disconnect, clean up resources) */
  stop(): Promise<void>;
  /** Get current channel status */
  status(): ChannelStatus;

  /** Send a message to the channel */
  sendMessage?(params: ChannelOutboundMessage): Promise<void>;
}

export interface ChannelStatus {
  connected: boolean;
  error?: string;
  /** Timestamp when connection was established */
  connectedSince?: number;
  /** Additional status details */
  details?: Record<string, unknown>;
}

export interface ChannelInboundMessage {
  channelId: string;
  senderId: string;
  senderName?: string;
  content: string;
  threadId?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutboundMessage {
  channelId: string;
  recipientId: string;
  content: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Handler called when a channel receives an inbound message.
 */
export type ChannelMessageHandler = (
  message: ChannelInboundMessage,
) => void | Promise<void>;
