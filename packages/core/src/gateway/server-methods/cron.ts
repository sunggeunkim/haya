import type { MethodHandler } from "../server-ws.js";
import type { CronService } from "../../cron/service.js";

export function createCronListHandler(
  cronService: CronService,
): MethodHandler {
  return async () => {
    return { jobs: cronService.getStore().list() };
  };
}

export function createCronStatusHandler(
  cronService: CronService,
): MethodHandler {
  return async () => {
    return {
      running: cronService.isRunning,
      activeTimers: cronService.activeTimerCount,
      jobs: cronService.getStore().list(),
    };
  };
}
