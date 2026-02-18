import type { ChannelPlugin, ChannelStatus } from "./types.js";
import { ChannelRegistry } from "./registry.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("channel-dock");

export interface ChannelDockStatus {
  channels: Array<{
    id: string;
    name: string;
    status: ChannelStatus;
  }>;
}

/**
 * Channel dock manages the lifecycle of all registered channels.
 * Provides start/stop/status operations across all channels.
 */
export class ChannelDock {
  private readonly registry: ChannelRegistry;
  private running = false;

  constructor(registry: ChannelRegistry) {
    this.registry = registry;
  }

  /**
   * Start all registered channels.
   * Continues starting remaining channels if one fails.
   */
  async startAll(): Promise<{
    started: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const started: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const channel of this.registry.list()) {
      try {
        await channel.start();
        started.push(channel.id);
        log.info(`Channel "${channel.id}" started`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failed.push({ id: channel.id, error });
        log.error(`Channel "${channel.id}" failed to start: ${error}`);
      }
    }

    this.running = true;
    return { started, failed };
  }

  /**
   * Stop all registered channels.
   */
  async stopAll(): Promise<void> {
    for (const channel of this.registry.list()) {
      try {
        await channel.stop();
        log.info(`Channel "${channel.id}" stopped`);
      } catch (err) {
        log.error(
          `Channel "${channel.id}" failed to stop: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.running = false;
  }

  /**
   * Start a specific channel by ID.
   */
  async startChannel(channelId: string): Promise<void> {
    const channel = this.registry.get(channelId);
    if (!channel) {
      throw new Error(`Channel "${channelId}" not found`);
    }
    await channel.start();
    log.info(`Channel "${channelId}" started`);
  }

  /**
   * Stop a specific channel by ID.
   */
  async stopChannel(channelId: string): Promise<void> {
    const channel = this.registry.get(channelId);
    if (!channel) {
      throw new Error(`Channel "${channelId}" not found`);
    }
    await channel.stop();
    log.info(`Channel "${channelId}" stopped`);
  }

  /**
   * Get the status of all channels.
   */
  status(): ChannelDockStatus {
    return {
      channels: this.registry.list().map((channel) => ({
        id: channel.id,
        name: channel.name,
        status: channel.status(),
      })),
    };
  }

  /**
   * Check if the dock is running.
   */
  get isRunning(): boolean {
    return this.running;
  }
}
