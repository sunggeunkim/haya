import type {
  ChannelPlugin,
  ChannelStatus,
  ChannelConfig,
  ChannelRuntime,
  InboundMessage,
} from "./types.js";
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
 * Provides start/stop/restart/status operations across all channels.
 * Wires inbound messages from channels to the agent runtime.
 */
export class ChannelDock {
  private readonly registry: ChannelRegistry;
  private running = false;
  private messageProcessor:
    | ((msg: InboundMessage) => Promise<void>)
    | null = null;

  constructor(registry: ChannelRegistry) {
    this.registry = registry;
  }

  /**
   * Set the function that processes inbound messages from channels
   * (typically the agent runtime's processMessage method).
   */
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageProcessor = handler;
  }

  /**
   * Start all registered channels.
   * Continues starting remaining channels if one fails.
   */
  async startAll(
    configs?: Map<string, ChannelConfig>,
  ): Promise<{
    started: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const started: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const channel of this.registry.list()) {
      try {
        const config = configs?.get(channel.id) ?? { settings: {} };
        const runtime = this.buildRuntime(channel.id);
        await channel.start(config, runtime);
        started.push(channel.id);
        log.info(`Channel "${channel.id}" started`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failed.push({ id: channel.id, error });
        log.error(`Channel "${channel.id}" failed to start: ${error}`);
      }
    }

    this.running = started.length > 0;
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
  async startChannel(
    channelId: string,
    config?: ChannelConfig,
  ): Promise<void> {
    const channel = this.registry.get(channelId);
    if (!channel) {
      throw new Error(`Channel "${channelId}" not found`);
    }
    const runtime = this.buildRuntime(channelId);
    await channel.start(config ?? { settings: {} }, runtime);
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
   * Restart a specific channel by ID (stop then start).
   */
  async restartChannel(
    channelId: string,
    config?: ChannelConfig,
  ): Promise<void> {
    const channel = this.registry.get(channelId);
    if (!channel) {
      throw new Error(`Channel "${channelId}" not found`);
    }
    await channel.stop();
    const runtime = this.buildRuntime(channelId);
    await channel.start(config ?? { settings: {} }, runtime);
    log.info(`Channel "${channelId}" restarted`);
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

  /**
   * Build a ChannelRuntime for a specific channel, wiring inbound
   * messages to the message processor.
   */
  private buildRuntime(channelId: string): ChannelRuntime {
    const channelLogger = createLogger(`channel:${channelId}`);

    return {
      onMessage: async (msg: InboundMessage) => {
        if (this.messageProcessor) {
          await this.messageProcessor(msg);
        } else {
          log.warn(
            `No message processor configured; dropping message from channel "${channelId}"`,
          );
        }
      },
      logger: channelLogger,
    };
  }
}
