import { z } from "zod";
import type { MethodHandler } from "../server-ws.js";
import type { CronService } from "../../cron/service.js";

export function createCronListHandler(
  cronService: CronService,
): MethodHandler {
  return async () => {
    return { jobs: cronService.listJobs() };
  };
}

export function createCronStatusHandler(
  cronService: CronService,
): MethodHandler {
  return async () => {
    return {
      running: cronService.isRunning,
      activeTimers: cronService.activeTimerCount,
      jobs: cronService.listJobs(),
    };
  };
}

const CronAddParamsSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  action: z.string().min(1),
  enabled: z.boolean().optional(),
});

export function createCronAddHandler(
  cronService: CronService,
): MethodHandler {
  return async (params) => {
    const parsed = CronAddParamsSchema.parse(params);
    const job = await cronService.addJob(parsed);
    return { job };
  };
}

const CronRemoveParamsSchema = z.object({
  jobId: z.string().min(1),
});

export function createCronRemoveHandler(
  cronService: CronService,
): MethodHandler {
  return async (params) => {
    const parsed = CronRemoveParamsSchema.parse(params);
    const removed = await cronService.removeJob(parsed.jobId);
    return { removed };
  };
}
