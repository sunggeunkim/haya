import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createCronListHandler,
  createCronStatusHandler,
  createCronAddHandler,
  createCronRemoveHandler,
} from "./cron.js";
import { CronService } from "../../cron/service.js";
import { CronStore } from "../../cron/store.js";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { CronJob } from "../../config/types.js";

let tempDir: string;
let store: CronStore;
let service: CronService;

const testJobs: CronJob[] = [
  {
    name: "test-job",
    schedule: "0 * * * *",
    action: "test",
    enabled: true,
  },
];

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "haya-cron-method-test-"));
  store = new CronStore(join(tempDir, "cron.json"));
  service = new CronService(store);
  await service.init(testJobs);
});

afterEach(async () => {
  service.stop();
  await rm(tempDir, { recursive: true, force: true });
});

describe("cron server methods", () => {
  describe("createCronListHandler", () => {
    it("returns list of cron jobs", async () => {
      const handler = createCronListHandler(service);
      const result = (await handler({}, "client-1")) as { jobs: unknown[] };

      expect(result.jobs).toHaveLength(1);
      expect((result.jobs[0] as { name: string }).name).toBe("test-job");
    });

    it("returns empty list when no jobs", async () => {
      const emptyStore = new CronStore(join(tempDir, "empty.json"));
      const emptyService = new CronService(emptyStore);
      await emptyService.init([]);

      const handler = createCronListHandler(emptyService);
      const result = (await handler({}, "client-1")) as { jobs: unknown[] };

      expect(result.jobs).toEqual([]);
    });
  });

  describe("createCronStatusHandler", () => {
    it("returns running status and job list", async () => {
      service.start();

      const handler = createCronStatusHandler(service);
      const result = (await handler({}, "client-1")) as {
        running: boolean;
        activeTimers: number;
        jobs: unknown[];
      };

      expect(result.running).toBe(true);
      expect(result.activeTimers).toBe(1);
      expect(result.jobs).toHaveLength(1);
    });

    it("returns not running when service is stopped", async () => {
      const handler = createCronStatusHandler(service);
      const result = (await handler({}, "client-1")) as {
        running: boolean;
        activeTimers: number;
        jobs: unknown[];
      };

      expect(result.running).toBe(false);
      expect(result.activeTimers).toBe(0);
    });
  });

  describe("createCronAddHandler", () => {
    it("adds a new cron job", async () => {
      const handler = createCronAddHandler(service);
      const result = (await handler(
        {
          name: "new-job",
          schedule: "*/10 * * * *",
          action: "new-action",
        },
        "client-1",
      )) as { job: { name: string; schedule: string } };

      expect(result.job.name).toBe("new-job");
      expect(result.job.schedule).toBe("*/10 * * * *");
      expect(service.listJobs()).toHaveLength(2);
    });

    it("throws on invalid params (missing name)", async () => {
      const handler = createCronAddHandler(service);
      await expect(
        handler({ schedule: "* * * * *", action: "a" }, "client-1"),
      ).rejects.toThrow();
    });

    it("throws on empty name", async () => {
      const handler = createCronAddHandler(service);
      await expect(
        handler(
          { name: "", schedule: "* * * * *", action: "a" },
          "client-1",
        ),
      ).rejects.toThrow();
    });
  });

  describe("createCronRemoveHandler", () => {
    it("removes a cron job by id", async () => {
      const job = store.list()[0];
      const handler = createCronRemoveHandler(service);
      const result = (await handler(
        { jobId: job.id },
        "client-1",
      )) as { removed: boolean };

      expect(result.removed).toBe(true);
      expect(service.listJobs()).toHaveLength(0);
    });

    it("returns false for non-existent job id", async () => {
      const handler = createCronRemoveHandler(service);
      const result = (await handler(
        { jobId: "nonexistent" },
        "client-1",
      )) as { removed: boolean };

      expect(result.removed).toBe(false);
    });

    it("throws on invalid params (missing jobId)", async () => {
      const handler = createCronRemoveHandler(service);
      await expect(handler({}, "client-1")).rejects.toThrow();
    });
  });
});
