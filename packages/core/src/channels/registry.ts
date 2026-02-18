import type { ChannelPlugin, ChannelMessageHandler } from "./types.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("channel-registry");

/**
 * Registry for channel plugins. Manages channel lifecycle and message routing.
 */
export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelPlugin>();
  private messageHandler: ChannelMessageHandler | null = null;

  /**
   * Register a channel plugin.
   */
  register(channel: ChannelPlugin): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Channel "${channel.id}" is already registered`);
    }
    this.channels.set(channel.id, channel);
    log.info(`Channel "${channel.id}" registered`);
  }

  /**
   * Unregister a channel plugin.
   */
  unregister(channelId: string): boolean {
    const removed = this.channels.delete(channelId);
    if (removed) {
      log.info(`Channel "${channelId}" unregistered`);
    }
    return removed;
  }

  /**
   * Get a channel by ID.
   */
  get(channelId: string): ChannelPlugin | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Check if a channel is registered.
   */
  has(channelId: string): boolean {
    return this.channels.has(channelId);
  }

  /**
   * List all registered channels.
   */
  list(): ChannelPlugin[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get the number of registered channels.
   */
  get size(): number {
    return this.channels.size;
  }

  /**
   * Set the handler for inbound messages from all channels.
   */
  onMessage(handler: ChannelMessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Get the current message handler.
   */
  getMessageHandler(): ChannelMessageHandler | null {
    return this.messageHandler;
  }
}
