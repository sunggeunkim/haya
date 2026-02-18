import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CronStore } from "./store.js";
import { join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { CronJob } from "../config/types.js";

let tempDir: string;
let storePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "haya-cron-test-"));
  storePath = join(tempDir, "cron.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const testJobs: CronJob[] = [
  {
    name: "daily-backup",
    schedule: "0 2 * * *",
    action: "backup",
    enabled: true,
  },
  {
    name: "hourly-sync",
    schedule: "0 * * * *",
    action: "sync",
    enabled: false,
  },
];

describe("CronStore", () => {
  it("loads config jobs into the store", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    expect(store.size).toBe(2);
    expect(store.getByName("daily-backup")).toBeDefined();
    expect(store.getByName("hourly-sync")).toBeDefined();
  });

  it("assigns UUIDs to new jobs", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    const job = store.getByName("daily-backup");
    expect(job?.id).toBeDefined();
    expect(job?.id.length).toBeGreaterThan(0);
  });

  it("preserves config fields on load", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    const job = store.getByName("daily-backup")!;
    expect(job.schedule).toBe("0 2 * * *");
    expect(job.action).toBe("backup");
    expect(job.enabled).toBe(true);
  });

  it("saves and reloads state", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);
    const originalId = store.getByName("daily-backup")!.id;
    await store.save();

    // Reload in a fresh store
    const store2 = new CronStore(storePath);
    await store2.load(testJobs);

    const reloaded = store2.getByName("daily-backup")!;
    expect(reloaded.id).toBe(originalId);
  });

  it("merges config with stored state preserving run history", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    const job = store.getByName("daily-backup")!;
    store.updateRunStatus(job.id, "ok");
    await store.save();

    // Reload
    const store2 = new CronStore(storePath);
    await store2.load(testJobs);

    const reloaded = store2.getByName("daily-backup")!;
    expect(reloaded.lastStatus).toBe("ok");
    expect(reloaded.lastRunAt).toBeDefined();
  });

  it("lists all jobs", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    const list = store.list();
    expect(list).toHaveLength(2);
  });

  it("lists only enabled jobs", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    const enabled = store.listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe("daily-backup");
  });

  it("gets a job by id", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    const job = store.getByName("daily-backup")!;
    expect(store.get(job.id)).toBe(job);
  });

  it("returns undefined for non-existent job id", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("returns undefined for non-existent job name", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    expect(store.getByName("nonexistent")).toBeUndefined();
  });

  it("updates run status to ok", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    const job = store.getByName("daily-backup")!;
    store.updateRunStatus(job.id, "ok");

    expect(job.lastStatus).toBe("ok");
    expect(job.lastRunAt).toBeDefined();
    expect(job.lastError).toBeUndefined();
  });

  it("updates run status to error with message", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);

    const job = store.getByName("daily-backup")!;
    store.updateRunStatus(job.id, "error", "Connection timeout");

    expect(job.lastStatus).toBe("error");
    expect(job.lastError).toBe("Connection timeout");
    expect(job.lastRunAt).toBeDefined();
  });

  it("ignores updateRunStatus for non-existent job", () => {
    const store = new CronStore(storePath);
    // Should not throw
    store.updateRunStatus("nonexistent", "ok");
  });

  it("saves with 0o600 permissions", async () => {
    const store = new CronStore(storePath);
    await store.load(testJobs);
    await store.save();

    const content = await readFile(storePath, "utf-8");
    const data = JSON.parse(content);
    expect(data.version).toBe(1);
    expect(data.jobs).toHaveLength(2);
  });

  it("handles missing store file gracefully", async () => {
    const store = new CronStore(join(tempDir, "nonexistent", "store.json"));
    await store.load(testJobs);

    // Still loads config jobs
    expect(store.size).toBe(2);
  });

  it("handles empty config jobs", async () => {
    const store = new CronStore(storePath);
    await store.load([]);

    expect(store.size).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it("sets createdAt and updatedAt timestamps", async () => {
    const before = Date.now();
    const store = new CronStore(storePath);
    await store.load(testJobs);
    const after = Date.now();

    const job = store.getByName("daily-backup")!;
    expect(job.createdAt).toBeGreaterThanOrEqual(before);
    expect(job.createdAt).toBeLessThanOrEqual(after);
    expect(job.updatedAt).toBeGreaterThanOrEqual(before);
    expect(job.updatedAt).toBeLessThanOrEqual(after);
  });
});
