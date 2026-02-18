import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "./service.js";
import { CronStore } from "./store.js";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { CronJob } from "../config/types.js";

let tempDir: string;
let store: CronStore;

const testJobs: CronJob[] = [
  {
    name: "fast-job",
    schedule: "* * * * * *", // every second (croner supports seconds)
    action: "test-action",
    enabled: true,
  },
  {
    name: "disabled-job",
    schedule: "0 0 * * *",
    action: "disabled-action",
    enabled: false,
  },
];

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "haya-cron-svc-test-"));
  store = new CronStore(join(tempDir, "cron.json"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("CronService", () => {
  it("initializes by loading jobs from store", async () => {
    const service = new CronService(store);
    await service.init(testJobs);

    expect(service.getStore().size).toBe(2);
  });

  it("starts and schedules enabled jobs", async () => {
    const service = new CronService(store);
    await service.init(testJobs);
    service.start();

    expect(service.isRunning).toBe(true);
    // Only the enabled job should be scheduled
    expect(service.activeTimerCount).toBe(1);

    service.stop();
  });

  it("does not start if already running", async () => {
    const service = new CronService(store);
    await service.init(testJobs);
    service.start();
    service.start(); // second call should be a no-op

    expect(service.activeTimerCount).toBe(1);
    service.stop();
  });

  it("stops and clears all timers", async () => {
    const service = new CronService(store);
    await service.init(testJobs);
    service.start();

    expect(service.activeTimerCount).toBe(1);

    service.stop();
    expect(service.isRunning).toBe(false);
    expect(service.activeTimerCount).toBe(0);
  });

  it("executes job action handler on trigger", async () => {
    const handler = vi.fn();
    const service = new CronService(store);
    service.onAction(handler);

    // Load only the fast job
    await service.init([testJobs[0]]);
    service.start();

    // Wait enough time for the cron to fire (every second)
    await new Promise((r) => setTimeout(r, 1500));

    service.stop();

    expect(handler).toHaveBeenCalled();
    const calledJob = handler.mock.calls[0][0];
    expect(calledJob.name).toBe("fast-job");
  });

  it("updates run status to ok on successful execution", async () => {
    const handler = vi.fn();
    const service = new CronService(store);
    service.onAction(handler);

    await service.init([testJobs[0]]);
    service.start();

    await new Promise((r) => setTimeout(r, 1500));
    service.stop();

    const job = store.getByName("fast-job")!;
    expect(job.lastStatus).toBe("ok");
    expect(job.lastRunAt).toBeDefined();
  });

  it("updates run status to error on failed execution", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("action failed"));
    const service = new CronService(store);
    service.onAction(handler);

    await service.init([testJobs[0]]);
    service.start();

    await new Promise((r) => setTimeout(r, 1500));
    service.stop();

    const job = store.getByName("fast-job")!;
    expect(job.lastStatus).toBe("error");
    expect(job.lastError).toBe("action failed");
  });

  it("skips execution when no action handler is set", async () => {
    const service = new CronService(store);

    await service.init([testJobs[0]]);
    service.start();

    await new Promise((r) => setTimeout(r, 1500));
    service.stop();

    // Job should not have been marked as run since there's no handler
    const job = store.getByName("fast-job")!;
    expect(job.lastRunAt).toBeUndefined();
  });

  it("exposes the store", async () => {
    const service = new CronService(store);
    expect(service.getStore()).toBe(store);
  });

  it("handles no enabled jobs gracefully", async () => {
    const service = new CronService(store);
    await service.init([testJobs[1]]); // only disabled job
    service.start();

    expect(service.isRunning).toBe(true);
    expect(service.activeTimerCount).toBe(0);

    service.stop();
  });

  it("handles empty jobs list", async () => {
    const service = new CronService(store);
    await service.init([]);
    service.start();

    expect(service.isRunning).toBe(true);
    expect(service.activeTimerCount).toBe(0);

    service.stop();
  });

  it("adds a job dynamically while running", async () => {
    const service = new CronService(store);
    await service.init([]);
    service.start();

    const entry = await service.addJob({
      name: "dynamic-job",
      schedule: "0 * * * *",
      action: "test",
    });

    expect(entry.name).toBe("dynamic-job");
    expect(service.activeTimerCount).toBe(1);
    expect(service.listJobs()).toHaveLength(1);

    service.stop();
  });

  it("adds a job dynamically while stopped (no scheduling)", async () => {
    const service = new CronService(store);
    await service.init([]);

    const entry = await service.addJob({
      name: "pending-job",
      schedule: "0 * * * *",
      action: "test",
    });

    expect(entry.name).toBe("pending-job");
    expect(service.activeTimerCount).toBe(0);
    expect(service.listJobs()).toHaveLength(1);
  });

  it("removes a job and stops its timer", async () => {
    const service = new CronService(store);
    await service.init([testJobs[0]]);
    service.start();

    expect(service.activeTimerCount).toBe(1);

    const job = store.getByName("fast-job")!;
    const removed = await service.removeJob(job.id);

    expect(removed).toBe(true);
    expect(service.activeTimerCount).toBe(0);
    expect(service.listJobs()).toHaveLength(0);

    service.stop();
  });

  it("returns false when removing non-existent job", async () => {
    const service = new CronService(store);
    await service.init([]);

    const removed = await service.removeJob("nonexistent");
    expect(removed).toBe(false);
  });

  it("lists all jobs", async () => {
    const service = new CronService(store);
    await service.init(testJobs);

    const jobs = service.listJobs();
    expect(jobs).toHaveLength(2);
  });
});
