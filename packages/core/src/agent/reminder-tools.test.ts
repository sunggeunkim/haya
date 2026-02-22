import { describe, it, expect, vi, beforeEach } from "vitest";
import { createReminderTools, isoToCronExpression } from "./reminder-tools.js";
import type { CronService } from "../cron/service.js";
import type { CronJobEntry } from "../cron/store.js";

function createMockCronService(): CronService {
  const mockEntry: CronJobEntry = {
    id: "job-abc-123",
    name: "reminder_1234",
    schedule: "30 14 15 3 *",
    action: "send_reminder",
    enabled: true,
    metadata: { message: "Test reminder", datetime: "2099-03-15T14:30:00" },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return {
    addJob: vi.fn().mockResolvedValue(mockEntry),
    removeJob: vi.fn().mockResolvedValue(true),
    listJobs: vi.fn().mockReturnValue([mockEntry]),
    start: vi.fn(),
    stop: vi.fn(),
    init: vi.fn(),
    onAction: vi.fn(),
    getStore: vi.fn(),
    isRunning: false,
    activeTimerCount: 0,
  } as unknown as CronService;
}

describe("isoToCronExpression", () => {
  it("converts a future datetime to a cron expression", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    future.setMonth(2); // March
    future.setDate(15);
    future.setHours(14, 30, 0, 0);
    const expr = isoToCronExpression(future.toISOString());
    expect(expr).toBe("30 14 15 3 *");
  });

  it("throws for invalid datetime", () => {
    expect(() => isoToCronExpression("not-a-date")).toThrow(
      "Invalid datetime",
    );
  });

  it("throws for past datetime", () => {
    expect(() => isoToCronExpression("2020-01-01T00:00:00")).toThrow(
      "must be in the future",
    );
  });
});

describe("createReminderTools", () => {
  it("returns three tools", () => {
    const service = createMockCronService();
    const tools = createReminderTools(service);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "reminder_set",
      "reminder_list",
      "reminder_cancel",
    ]);
  });

  it("all tools have required fields", () => {
    const service = createMockCronService();
    const tools = createReminderTools(service);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.defaultPolicy).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

describe("reminder_set", () => {
  let service: CronService;

  beforeEach(() => {
    service = createMockCronService();
  });

  it("creates a cron job with the correct params", async () => {
    const tools = createReminderTools(service);
    const set = tools.find((t) => t.name === "reminder_set")!;

    const result = await set.execute({
      datetime: "2099-03-15T14:30:00",
      message: "Call the dentist",
    });

    expect(result).toContain("job-abc-123");
    expect(result).toContain("Call the dentist");
    expect(service.addJob).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "send_reminder",
        enabled: true,
        metadata: expect.objectContaining({
          message: "Call the dentist",
          datetime: "2099-03-15T14:30:00",
        }),
      }),
    );
  });

  it("throws if datetime is missing", async () => {
    const tools = createReminderTools(service);
    const set = tools.find((t) => t.name === "reminder_set")!;

    await expect(
      set.execute({ message: "test" }),
    ).rejects.toThrow("datetime is required");
  });

  it("throws if message is missing", async () => {
    const tools = createReminderTools(service);
    const set = tools.find((t) => t.name === "reminder_set")!;

    await expect(
      set.execute({ datetime: "2099-03-15T14:30:00" }),
    ).rejects.toThrow("message is required");
  });
});

describe("reminder_list", () => {
  it("returns formatted list of reminders", async () => {
    const service = createMockCronService();
    const tools = createReminderTools(service);
    const list = tools.find((t) => t.name === "reminder_list")!;

    const result = await list.execute({});

    expect(result).toContain("job-abc-123");
    expect(result).toContain("Test reminder");
    expect(result).toContain("2099-03-15T14:30:00");
  });

  it("returns no-reminders message when empty", async () => {
    const service = createMockCronService();
    (service.listJobs as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const tools = createReminderTools(service);
    const list = tools.find((t) => t.name === "reminder_list")!;

    const result = await list.execute({});
    expect(result).toBe("No active reminders.");
  });

  it("filters to only send_reminder actions", async () => {
    const service = createMockCronService();
    (service.listJobs as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: "job-1",
        name: "other_job",
        schedule: "0 0 * * *",
        action: "prune_sessions",
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "job-2",
        name: "reminder_999",
        schedule: "0 9 1 1 *",
        action: "send_reminder",
        enabled: true,
        metadata: { message: "New Year!" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const tools = createReminderTools(service);
    const list = tools.find((t) => t.name === "reminder_list")!;

    const result = await list.execute({});
    expect(result).not.toContain("other_job");
    expect(result).toContain("job-2");
    expect(result).toContain("New Year!");
  });
});

describe("reminder_cancel", () => {
  it("removes the job by ID", async () => {
    const service = createMockCronService();
    const tools = createReminderTools(service);
    const cancel = tools.find((t) => t.name === "reminder_cancel")!;

    const result = await cancel.execute({ id: "job-abc-123" });
    expect(result).toContain("cancelled");
    expect(service.removeJob).toHaveBeenCalledWith("job-abc-123");
  });

  it("reports not found when job does not exist", async () => {
    const service = createMockCronService();
    (service.removeJob as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const tools = createReminderTools(service);
    const cancel = tools.find((t) => t.name === "reminder_cancel")!;

    const result = await cancel.execute({ id: "no-such-id" });
    expect(result).toContain("not found");
  });

  it("throws if id is missing", async () => {
    const service = createMockCronService();
    const tools = createReminderTools(service);
    const cancel = tools.find((t) => t.name === "reminder_cancel")!;

    await expect(cancel.execute({})).rejects.toThrow("id is required");
  });
});
