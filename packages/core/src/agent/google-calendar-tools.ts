import type { AgentTool } from "./types.js";
import type { GoogleAuth } from "../google/auth.js";
import { callGoogleApi } from "../google/auth.js";

const MAX_RESPONSE_LENGTH = 16_000;
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncate(text: string): string {
  if (text.length > MAX_RESPONSE_LENGTH) {
    return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
  }
  return text;
}

function formatEventTime(
  ev: Record<string, unknown>,
  field: "start" | "end",
): string {
  const block = ev[field] as Record<string, string> | undefined;
  if (!block) return "?";
  return block.dateTime ?? block.date ?? "?";
}

function formatEvent(ev: Record<string, unknown>): string {
  const summary = (ev.summary as string) ?? "(no title)";
  const start = formatEventTime(ev, "start");
  const end = formatEventTime(ev, "end");
  const location = ev.location as string | undefined;
  let line = `- ${summary} | ${start} → ${end}`;
  if (location) line += ` | ${location}`;
  return line;
}

// ---------------------------------------------------------------------------
// calendar_list_events  (policy: allow)
// ---------------------------------------------------------------------------

function createListEventsTool(auth: GoogleAuth): AgentTool {
  return {
    name: "calendar_list_events",
    description:
      "List upcoming events from a Google Calendar. " +
      "Returns events sorted by start time with summary, time range, and location.",
    parameters: {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          description:
            'Calendar ID to list events from (default: "primary")',
        },
        timeMin: {
          type: "string",
          description:
            "Lower bound (inclusive) for event start time (ISO 8601 format)",
        },
        timeMax: {
          type: "string",
          description:
            "Upper bound (exclusive) for event start time (ISO 8601 format)",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of events to return (default: 10)",
        },
        q: {
          type: "string",
          description: "Free text search filter for events",
        },
      },
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const calendarId = (args.calendarId as string) || "primary";
      const maxResults = (args.maxResults as number) ?? 10;

      const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", String(maxResults));

      if (args.timeMin) url.searchParams.set("timeMin", args.timeMin as string);
      if (args.timeMax) url.searchParams.set("timeMax", args.timeMax as string);
      if (args.q) url.searchParams.set("q", args.q as string);

      const data = await callGoogleApi(url.toString(), auth);
      const items = (data.items as Array<Record<string, unknown>>) ?? [];

      if (items.length === 0) {
        return "No events found.";
      }

      const lines = items.map(formatEvent);
      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_search_events
// ---------------------------------------------------------------------------

function createSearchEventsTool(auth: GoogleAuth): AgentTool {
  return {
    name: "calendar_search_events",
    description:
      "Search for events in a Google Calendar by keyword. " +
      "Returns matching events sorted by start time.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to match against event fields",
        },
        calendarId: {
          type: "string",
          description:
            'Calendar ID to search in (default: "primary")',
        },
        timeMin: {
          type: "string",
          description:
            "Lower bound (inclusive) for event start time (ISO 8601 format)",
        },
        timeMax: {
          type: "string",
          description:
            "Upper bound (exclusive) for event start time (ISO 8601 format)",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of events to return (default: 10)",
        },
      },
      required: ["query"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const query = args.query as string;
      if (!query) throw new Error("query is required");

      const calendarId = (args.calendarId as string) || "primary";
      const maxResults = (args.maxResults as number) ?? 10;

      const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("q", query);

      if (args.timeMin) url.searchParams.set("timeMin", args.timeMin as string);
      if (args.timeMax) url.searchParams.set("timeMax", args.timeMax as string);

      const data = await callGoogleApi(url.toString(), auth);
      const items = (data.items as Array<Record<string, unknown>>) ?? [];

      if (items.length === 0) {
        return `No events found matching "${query}".`;
      }

      const lines = items.map(formatEvent);
      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_list_calendars
// ---------------------------------------------------------------------------

function createListCalendarsTool(auth: GoogleAuth): AgentTool {
  return {
    name: "calendar_list_calendars",
    description:
      "List all calendars accessible by the authenticated user. " +
      "Returns calendar name, ID, and primary status.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(): Promise<string> {
      const url = `${CALENDAR_API_BASE}/users/me/calendarList`;
      const data = await callGoogleApi(url, auth);
      const items = (data.items as Array<Record<string, unknown>>) ?? [];

      if (items.length === 0) {
        return "No calendars found.";
      }

      const lines = items.map((cal) => {
        const summary = (cal.summary as string) ?? "(unnamed)";
        const id = cal.id as string;
        const primary = cal.primary ? " [primary]" : "";
        return `- ${summary} (${id})${primary}`;
      });

      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_get_freebusy
// ---------------------------------------------------------------------------

function createGetFreeBusyTool(auth: GoogleAuth): AgentTool {
  return {
    name: "calendar_get_freebusy",
    description:
      "Check free/busy information for one or more calendars over a time range. " +
      "Returns busy time periods for each requested calendar.",
    parameters: {
      type: "object",
      properties: {
        timeMin: {
          type: "string",
          description: "Start of the time range (ISO 8601 format, required)",
        },
        timeMax: {
          type: "string",
          description: "End of the time range (ISO 8601 format, required)",
        },
        calendarIds: {
          type: "array",
          items: { type: "string" },
          description:
            'Calendar IDs to check (default: ["primary"])',
        },
      },
      required: ["timeMin", "timeMax"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const timeMin = args.timeMin as string;
      const timeMax = args.timeMax as string;
      if (!timeMin) throw new Error("timeMin is required");
      if (!timeMax) throw new Error("timeMax is required");

      const calendarIds = (args.calendarIds as string[]) ?? ["primary"];
      const items = calendarIds.map((id) => ({ id }));

      const url = `${CALENDAR_API_BASE}/freeBusy`;
      const data = await callGoogleApi(url, auth, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeMin, timeMax, items }),
      });

      const calendars = data.calendars as Record<
        string,
        { busy: Array<{ start: string; end: string }> }
      >;

      if (!calendars) {
        return "No free/busy data returned.";
      }

      const lines: string[] = [];
      for (const [calId, info] of Object.entries(calendars)) {
        lines.push(`Calendar: ${calId}`);
        if (!info.busy || info.busy.length === 0) {
          lines.push("  No busy periods.");
        } else {
          for (const period of info.busy) {
            lines.push(`  Busy: ${period.start} → ${period.end}`);
          }
        }
      }

      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_create_event
// ---------------------------------------------------------------------------

function createCreateEventTool(auth: GoogleAuth): AgentTool {
  return {
    name: "calendar_create_event",
    description:
      "Create a new event in a Google Calendar. " +
      "Supports timed events, all-day events, descriptions, locations, and attendees.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Title of the event",
        },
        start: {
          type: "string",
          description:
            "Start time in ISO 8601 format (e.g. 2024-01-15T09:00:00-05:00) or date for all-day (2024-01-15)",
        },
        end: {
          type: "string",
          description:
            "End time in ISO 8601 format or date for all-day events",
        },
        description: {
          type: "string",
          description: "Description/notes for the event",
        },
        location: {
          type: "string",
          description: "Location of the event",
        },
        attendees: {
          type: "string",
          description:
            "Comma-separated email addresses of attendees",
        },
        calendarId: {
          type: "string",
          description: 'Calendar ID (default: "primary")',
        },
        timeZone: {
          type: "string",
          description:
            "Time zone for the event (e.g. America/New_York)",
        },
        allDay: {
          type: "boolean",
          description:
            "If true, create an all-day event using date-only start/end",
        },
      },
      required: ["summary", "start", "end"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const summary = args.summary as string;
      const start = args.start as string;
      const end = args.end as string;
      if (!summary) throw new Error("summary is required");
      if (!start) throw new Error("start is required");
      if (!end) throw new Error("end is required");

      const calendarId = (args.calendarId as string) || "primary";
      const allDay = args.allDay as boolean;
      const timeZone = args.timeZone as string | undefined;

      const eventBody: Record<string, unknown> = { summary };

      if (allDay) {
        eventBody.start = { date: start };
        eventBody.end = { date: end };
      } else {
        const startObj: Record<string, string> = { dateTime: start };
        const endObj: Record<string, string> = { dateTime: end };
        if (timeZone) {
          startObj.timeZone = timeZone;
          endObj.timeZone = timeZone;
        }
        eventBody.start = startObj;
        eventBody.end = endObj;
      }

      if (args.description) eventBody.description = args.description as string;
      if (args.location) eventBody.location = args.location as string;

      if (args.attendees) {
        const emails = (args.attendees as string)
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean);
        eventBody.attendees = emails.map((email) => ({ email }));
      }

      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
      const data = await callGoogleApi(url, auth, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventBody),
      });

      const eventId = data.id as string;
      const htmlLink = data.htmlLink as string;
      let result = `Event created: ${summary} (${eventId})`;
      if (htmlLink) result += `\nLink: ${htmlLink}`;
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_update_event
// ---------------------------------------------------------------------------

function createUpdateEventTool(auth: GoogleAuth): AgentTool {
  return {
    name: "calendar_update_event",
    description:
      "Update an existing event in a Google Calendar. " +
      "Only the provided fields will be modified.",
    parameters: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "The ID of the event to update",
        },
        calendarId: {
          type: "string",
          description: 'Calendar ID (default: "primary")',
        },
        summary: {
          type: "string",
          description: "New title for the event",
        },
        start: {
          type: "string",
          description: "New start time (ISO 8601 format)",
        },
        end: {
          type: "string",
          description: "New end time (ISO 8601 format)",
        },
        description: {
          type: "string",
          description: "New description for the event",
        },
        location: {
          type: "string",
          description: "New location for the event",
        },
        attendees: {
          type: "string",
          description:
            "Comma-separated email addresses of attendees (replaces existing)",
        },
      },
      required: ["eventId"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const eventId = args.eventId as string;
      if (!eventId) throw new Error("eventId is required");

      const calendarId = (args.calendarId as string) || "primary";
      const body: Record<string, unknown> = {};

      if (args.summary !== undefined) body.summary = args.summary as string;
      if (args.description !== undefined)
        body.description = args.description as string;
      if (args.location !== undefined) body.location = args.location as string;
      if (args.start !== undefined)
        body.start = { dateTime: args.start as string };
      if (args.end !== undefined) body.end = { dateTime: args.end as string };

      if (args.attendees !== undefined) {
        const emails = (args.attendees as string)
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean);
        body.attendees = emails.map((email) => ({ email }));
      }

      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
      const data = await callGoogleApi(url, auth, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const updatedSummary = (data.summary as string) ?? "(no title)";
      return `Event updated: ${updatedSummary} (${eventId})`;
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_delete_event
// ---------------------------------------------------------------------------

function createDeleteEventTool(auth: GoogleAuth): AgentTool {
  return {
    name: "calendar_delete_event",
    description:
      "Delete an event from a Google Calendar. " +
      "This permanently removes the event.",
    parameters: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "The ID of the event to delete",
        },
        calendarId: {
          type: "string",
          description: 'Calendar ID (default: "primary")',
        },
      },
      required: ["eventId"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const eventId = args.eventId as string;
      if (!eventId) throw new Error("eventId is required");

      const calendarId = (args.calendarId as string) || "primary";

      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
      const token = await auth.getAccessToken();

      // DELETE returns 204 No Content — use fetch directly instead of callGoogleApi
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Haya/0.1",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google API ${response.status}: ${errText}`);
      }

      return `Event deleted: ${eventId}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createCalendarTools(auth: GoogleAuth): AgentTool[] {
  return [
    createListEventsTool(auth),
    createSearchEventsTool(auth),
    createListCalendarsTool(auth),
    createGetFreeBusyTool(auth),
    createCreateEventTool(auth),
    createUpdateEventTool(auth),
    createDeleteEventTool(auth),
  ];
}
