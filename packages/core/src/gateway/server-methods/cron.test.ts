import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCronListHandler, createCronStatusHandler } from "./cron.js";
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
});
