import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { CronJob } from "../config/types.js";

export interface CronJobEntry {
  id: string;
  name: string;
  schedule: string;
  action: string;
  enabled: boolean;
  lastRunAt?: number;
  lastStatus?: "ok" | "error";
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

interface CronStoreFile {
  version: 1;
  jobs: CronJobEntry[];
}

/**
 * Persistent store for cron job state.
 * Jobs are stored as JSON with file-level locking via atomic writes.
 */
export class CronStore {
  private jobs = new Map<string, CronJobEntry>();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Load jobs from the store file. Merges with config-defined jobs.
   */
  async load(configJobs: CronJob[]): Promise<void> {
    // Try to load existing store
    let storedJobs: CronJobEntry[] = [];
    try {
      const content = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(content) as CronStoreFile;
      if (data.version === 1 && Array.isArray(data.jobs)) {
        storedJobs = data.jobs;
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
    }

    // Build lookup of stored jobs by name
    const storedByName = new Map<string, CronJobEntry>();
    for (const job of storedJobs) {
      storedByName.set(job.name, job);
    }

    // Merge config jobs with stored state
    this.jobs.clear();
    const now = Date.now();

    for (const configJob of configJobs) {
      const existing = storedByName.get(configJob.name);
      const entry: CronJobEntry = {
        id: existing?.id ?? randomUUID(),
        name: configJob.name,
        schedule: configJob.schedule,
        action: configJob.action,
        enabled: configJob.enabled,
        lastRunAt: existing?.lastRunAt,
        lastStatus: existing?.lastStatus,
        lastError: existing?.lastError,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.jobs.set(entry.id, entry);
    }
  }

  /**
   * Save current state to the store file.
   */
  async save(): Promise<void> {
    const data: CronStoreFile = {
      version: 1,
      jobs: Array.from(this.jobs.values()),
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Get a job by ID.
   */
  get(jobId: string): CronJobEntry | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get a job by name.
   */
  getByName(name: string): CronJobEntry | undefined {
    for (const job of this.jobs.values()) {
      if (job.name === name) return job;
    }
    return undefined;
  }

  /**
   * List all jobs.
   */
  list(): CronJobEntry[] {
    return Array.from(this.jobs.values());
  }

  /**
   * List only enabled jobs.
   */
  listEnabled(): CronJobEntry[] {
    return this.list().filter((j) => j.enabled);
  }

  /**
   * Update a job's run status.
   */
  updateRunStatus(
    jobId: string,
    status: "ok" | "error",
    error?: string,
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.lastRunAt = Date.now();
    job.lastStatus = status;
    job.lastError = error;
    job.updatedAt = Date.now();
  }

  /**
   * Get the number of jobs.
   */
  get size(): number {
    return this.jobs.size;
  }
}
