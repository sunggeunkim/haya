import { Cron } from "croner";
import type { CronJobEntry } from "./store.js";
import { CronStore } from "./store.js";
import type { CronJob } from "../config/types.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("cron-service");

export type CronActionHandler = (
  job: CronJobEntry,
) => void | Promise<void>;

/**
 * Cron scheduler service. Manages scheduled jobs using croner.
 */
export class CronService {
  private readonly store: CronStore;
  private readonly timers = new Map<string, Cron>();
  private actionHandler: CronActionHandler | null = null;
  private running = false;

  constructor(store: CronStore) {
    this.store = store;
  }

  /**
   * Set the handler for cron job execution.
   */
  onAction(handler: CronActionHandler): void {
    this.actionHandler = handler;
  }

  /**
   * Initialize the service: load jobs from config and store.
   */
  async init(configJobs: CronJob[], storePath?: string): Promise<void> {
    await this.store.load(configJobs);
  }

  /**
   * Start all enabled cron jobs.
   */
  start(): void {
    if (this.running) return;

    for (const job of this.store.listEnabled()) {
      this.scheduleJob(job);
    }

    this.running = true;
    log.info(
      `Cron service started with ${this.timers.size} job(s)`,
    );
  }

  /**
   * Stop all cron jobs and clean up timers.
   */
  stop(): void {
    for (const [jobId, timer] of this.timers) {
      timer.stop();
      this.timers.delete(jobId);
    }
    this.running = false;
    log.info("Cron service stopped");
  }

  /**
   * Get the cron store.
   */
  getStore(): CronStore {
    return this.store;
  }

  /**
   * Check if the service is running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the number of active timers.
   */
  get activeTimerCount(): number {
    return this.timers.size;
  }

  private scheduleJob(job: CronJobEntry): void {
    try {
      const timer = new Cron(job.schedule, async () => {
        await this.executeJob(job);
      });
      this.timers.set(job.id, timer);
      log.info(
        `Scheduled job "${job.name}" (${job.schedule})`,
      );
    } catch (err) {
      log.error(
        `Failed to schedule job "${job.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async executeJob(job: CronJobEntry): Promise<void> {
    log.info(`Executing cron job "${job.name}"`);

    if (!this.actionHandler) {
      log.warn(`No action handler configured, skipping job "${job.name}"`);
      return;
    }

    try {
      await this.actionHandler(job);
      this.store.updateRunStatus(job.id, "ok");
      log.info(`Cron job "${job.name}" completed successfully`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.store.updateRunStatus(job.id, "error", error);
      log.error(`Cron job "${job.name}" failed: ${error}`);
    }

    // Persist updated state
    try {
      await this.store.save();
    } catch (err) {
      log.warn(
        `Failed to persist cron store: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
