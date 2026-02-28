import type { BuiltinTool } from "./builtin-tools.js";
import type { CronService } from "../cron/service.js";

/**
 * Convert an ISO 8601 datetime string to a croner-compatible cron expression.
 * Returns a 5-field expression: minute hour day month weekday.
 */
export function isoToCronExpression(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid datetime: ${iso}`);
  }

  if (date.getTime() <= Date.now()) {
    throw new Error("Reminder datetime must be in the future");
  }

  const minute = date.getMinutes();
  const hour = date.getHours();
  const day = date.getDate();
  const month = date.getMonth() + 1; // 0-indexed → 1-indexed
  const weekday = "*";

  return `${minute} ${hour} ${day} ${month} ${weekday}`;
}

/**
 * Create agent tools for setting, listing, and cancelling reminders.
 * Reminders are backed by the cron service with `action: "send_reminder"`.
 */
export function createReminderTools(
  cronService: CronService,
): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------
    // reminder_set
    // -----------------------------------------------------------------
    {
      name: "reminder_set",
      description:
        "Set a local one-shot reminder that delivers a message via the gateway at " +
        "a specific date and time. IMPORTANT: Prefer using Google Calendar (google_calendar_create_event) " +
        "or Todoist (todoist_tasks with action 'create') for reminders when those tools are available — " +
        "they sync across devices. Only use this tool as a fallback when no calendar or task service is configured. " +
        "Provide the datetime in ISO 8601 format.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          datetime: {
            type: "string",
            description:
              "When to trigger the reminder in ISO 8601 format (e.g. '2025-03-15T09:00:00')",
          },
          message: {
            type: "string",
            description: "The reminder message to deliver",
          },
        },
        required: ["datetime", "message"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const datetime = args.datetime as string;
        const message = args.message as string;
        if (!datetime) throw new Error("datetime is required");
        if (!message) throw new Error("message is required");

        const schedule = isoToCronExpression(datetime);
        const name = `reminder_${Date.now()}`;

        const entry = await cronService.addJob({
          name,
          schedule,
          action: "send_reminder",
          enabled: true,
          metadata: { message, datetime },
        });

        const date = new Date(datetime);
        return (
          `Reminder set for ${date.toLocaleString()}\n` +
          `ID: ${entry.id}\n` +
          `Message: ${message}`
        );
      },
    },

    // -----------------------------------------------------------------
    // reminder_list
    // -----------------------------------------------------------------
    {
      name: "reminder_list",
      description: "List all active reminders.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const jobs = cronService.listJobs().filter(
          (j) => j.action === "send_reminder" && j.enabled,
        );

        if (jobs.length === 0) {
          return "No active reminders.";
        }

        const lines: string[] = [];
        for (const job of jobs) {
          const meta = job.metadata ?? {};
          const message = (meta.message as string) ?? "(no message)";
          const datetime = (meta.datetime as string) ?? job.schedule;
          lines.push(`- ID: ${job.id}`);
          lines.push(`  When: ${datetime}`);
          lines.push(`  Message: ${message}`);
        }
        return lines.join("\n");
      },
    },

    // -----------------------------------------------------------------
    // reminder_cancel
    // -----------------------------------------------------------------
    {
      name: "reminder_cancel",
      description:
        "Cancel a reminder by its ID. Use reminder_list to find the ID.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The reminder ID to cancel",
          },
        },
        required: ["id"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const id = args.id as string;
        if (!id) throw new Error("id is required");

        const removed = await cronService.removeJob(id);
        if (!removed) {
          return `Reminder ${id} not found.`;
        }
        return `Reminder ${id} cancelled.`;
      },
    },
  ];
}
