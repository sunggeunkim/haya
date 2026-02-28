import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const LECTIONARY_API_URL = "http://lectio-api.org/api/v1";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface LectionaryReading {
  type: string;
  citation: string;
  text: string;
  isAlternative: boolean;
  office?: string;
}

interface LectionaryDailyOffice {
  morning: LectionaryReading[];
  evening: LectionaryReading[];
}

interface LectionaryData {
  id: string;
  date: string;
  traditionId: string;
  season: string | null;
  year: string | null;
  dayName: string;
  liturgicalColor: string | null;
  readings: LectionaryReading[];
}

interface LectionaryResponse {
  date: string;
  dayOfWeek: string;
  tradition: string;
  timestamp: string;
  dailyOffice: LectionaryDailyOffice;
  data: LectionaryData;
}

interface LectionaryTradition {
  id: string;
  name: string;
  description: string;
}

interface CalendarSeason {
  name: string;
  startDate: string;
  endDate: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates Lectionary tools (lectio-api.org, no API key needed). */
export function createLectionaryTools(): BuiltinTool[] {
  return [
    // ----- lectionary_today -----
    {
      name: "lectionary_today",
      description:
        "Get today's lectionary readings (scripture passages assigned for worship). " +
        "Supports Revised Common Lectionary (RCL), Roman Catholic, and Episcopal traditions. " +
        "Returns daily office readings (morning/evening) and principal service readings.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          tradition: {
            type: "string",
            description:
              'Lectionary tradition: "rcl" (Revised Common Lectionary), "catholic", or "episcopal" (default: "rcl")',
          },
          date: {
            type: "string",
            description:
              "Specific date in YYYY-MM-DD format (default: today)",
          },
        },
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const tradition = (args.tradition as string) ?? "rcl";
        const date = args.date as string | undefined;

        const endpoint = date ? "readings" : "readings/today";
        const params = new URLSearchParams({ tradition });
        if (date) {
          params.set("date", date);
        }
        const url = `${LECTIONARY_API_URL}/${endpoint}?${params.toString()}`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Lectionary API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as LectionaryResponse;

        const lines: string[] = [
          `Lectionary Readings — ${data.dayOfWeek}, ${data.date}`,
          `Tradition: ${data.tradition.toUpperCase()}`,
        ];

        if (data.data.dayName) {
          lines.push(`Day: ${data.data.dayName}`);
        }
        if (data.data.season) {
          lines.push(`Season: ${data.data.season}`);
        }
        if (data.data.liturgicalColor) {
          lines.push(`Liturgical Color: ${data.data.liturgicalColor}`);
        }

        // Morning readings
        if (data.dailyOffice.morning.length > 0) {
          lines.push("", "Morning Readings:");
          for (const r of data.dailyOffice.morning) {
            const alt = r.isAlternative ? " (alternative)" : "";
            lines.push(`  ${r.type}: ${r.citation}${alt}`);
          }
        }

        // Evening readings
        if (data.dailyOffice.evening.length > 0) {
          lines.push("", "Evening Readings:");
          for (const r of data.dailyOffice.evening) {
            const alt = r.isAlternative ? " (alternative)" : "";
            lines.push(`  ${r.type}: ${r.citation}${alt}`);
          }
        }

        return lines.join("\n");
      },
    },

    // ----- lectionary_traditions -----
    {
      name: "lectionary_traditions",
      description:
        "List available lectionary traditions supported by the Lectionary API. " +
        "Returns tradition IDs that can be used with lectionary_today.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const url = `${LECTIONARY_API_URL}/traditions`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Lectionary API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as LectionaryTradition[];

        if (!Array.isArray(data) || data.length === 0) {
          return "No traditions available.";
        }

        const lines: string[] = ["Available Lectionary Traditions:", ""];
        for (const t of data) {
          lines.push(`- ${t.id}: ${t.name}`);
          if (t.description) {
            lines.push(`  ${t.description}`);
          }
        }

        return lines.join("\n");
      },
    },

    // ----- lectionary_calendar -----
    {
      name: "lectionary_calendar",
      description:
        "Get the current liturgical season or view liturgical seasons for a given year. " +
        "Returns season names, dates, and liturgical colors.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          year: {
            type: "number",
            description:
              "Year to look up liturgical seasons for (default: current year)",
          },
        },
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const year = args.year as number | undefined;
        const url = year
          ? `${LECTIONARY_API_URL}/calendar/${year}/seasons`
          : `${LECTIONARY_API_URL}/calendar/current`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Lectionary API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as CalendarSeason | CalendarSeason[];

        if (Array.isArray(data)) {
          if (data.length === 0) {
            return `No liturgical seasons found for ${year}.`;
          }

          const lines: string[] = [
            `Liturgical Seasons for ${year}:`,
            "",
          ];
          for (const s of data) {
            lines.push(`- ${s.name} (${s.startDate} to ${s.endDate})`);
            if (s.color) {
              lines.push(`  Color: ${s.color}`);
            }
          }
          return lines.join("\n");
        }

        // Single season (current)
        const s = data;
        const lines: string[] = [
          "Current Liturgical Season:",
          "",
          `Season: ${s.name}`,
          `Period: ${s.startDate} to ${s.endDate}`,
        ];
        if (s.color) {
          lines.push(`Color: ${s.color}`);
        }
        return lines.join("\n");
      },
    },
  ];
}
