import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarTools } from "./google-calendar-tools.js";
import type { AgentTool } from "./types.js";
import type { GoogleAuth } from "../google/auth.js";

// Helper to get a tool by name
function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// Shared mock auth object
function createMockAuth(): GoogleAuth {
  return {
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
    isAuthorized: vi.fn().mockReturnValue(true),
    authorize: vi.fn(),
    revokeTokens: vi.fn(),
    config: {
      clientIdEnvVar: "GOOGLE_CLIENT_ID",
      clientSecretEnvVar: "GOOGLE_CLIENT_SECRET",
      scopes: [],
    },
  } as unknown as GoogleAuth;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createCalendarTools", () => {
  it("returns exactly 7 tools", () => {
    const tools = createCalendarTools(createMockAuth());
    expect(tools).toHaveLength(7);
  });

  it("returns tools with expected names", () => {
    const tools = createCalendarTools(createMockAuth());
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "calendar_create_event",
      "calendar_delete_event",
      "calendar_get_freebusy",
      "calendar_list_calendars",
      "calendar_list_events",
      "calendar_search_events",
      "calendar_update_event",
    ]);
  });
});

// ---------------------------------------------------------------------------
// calendar_list_events
// ---------------------------------------------------------------------------

describe("calendar_list_events", () => {
  let tools: AgentTool[];
  let listEvents: AgentTool;
  let mockAuth: GoogleAuth;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createCalendarTools(mockAuth);
    listEvents = getTool(tools, "calendar_list_events");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const eventsResponse = {
    items: [
      {
        summary: "Team Standup",
        start: { dateTime: "2024-01-15T09:00:00-05:00" },
        end: { dateTime: "2024-01-15T09:30:00-05:00" },
        location: "Room 101",
      },
      {
        summary: "Lunch",
        start: { dateTime: "2024-01-15T12:00:00-05:00" },
        end: { dateTime: "2024-01-15T13:00:00-05:00" },
      },
    ],
  };

  it("returns formatted events on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(eventsResponse)),
    );

    const result = await listEvents.execute({});

    expect(result).toContain("Team Standup");
    expect(result).toContain("2024-01-15T09:00:00-05:00");
    expect(result).toContain("2024-01-15T09:30:00-05:00");
    expect(result).toContain("Room 101");
    expect(result).toContain("Lunch");
  });

  it("returns 'No events found.' for empty list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] })),
    );

    const result = await listEvents.execute({});
    expect(result).toBe("No events found.");
  });

  it("handles all-day events with date instead of dateTime", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              summary: "Holiday",
              start: { date: "2024-12-25" },
              end: { date: "2024-12-26" },
            },
          ],
        }),
      ),
    );

    const result = await listEvents.execute({});
    expect(result).toContain("Holiday");
    expect(result).toContain("2024-12-25");
    expect(result).toContain("2024-12-26");
  });

  it("passes query params to the API URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(eventsResponse)),
      );

    await listEvents.execute({
      calendarId: "work@example.com",
      timeMin: "2024-01-01T00:00:00Z",
      timeMax: "2024-12-31T23:59:59Z",
      maxResults: 5,
      q: "meeting",
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("work%40example.com");
    expect(calledUrl).toContain("singleEvents=true");
    expect(calledUrl).toContain("orderBy=startTime");
    expect(calledUrl).toContain("maxResults=5");
    expect(calledUrl).toContain(encodeURIComponent("2024-01-01T00:00:00Z"));
    expect(calledUrl).toContain(encodeURIComponent("2024-12-31T23:59:59Z"));
    expect(calledUrl).toContain("q=meeting");
  });

  it("uses primary as default calendarId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(eventsResponse)),
      );

    await listEvents.execute({});

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/calendars/primary/events");
  });
});

// ---------------------------------------------------------------------------
// calendar_search_events
// ---------------------------------------------------------------------------

describe("calendar_search_events", () => {
  let tools: AgentTool[];
  let searchEvents: AgentTool;
  let mockAuth: GoogleAuth;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createCalendarTools(mockAuth);
    searchEvents = getTool(tools, "calendar_search_events");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires query parameter", async () => {
    await expect(searchEvents.execute({})).rejects.toThrow(
      "query is required",
    );
  });

  it("requires non-empty query parameter", async () => {
    await expect(searchEvents.execute({ query: "" })).rejects.toThrow(
      "query is required",
    );
  });

  it("passes q parameter to API", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                summary: "Team Meeting",
                start: { dateTime: "2024-01-15T10:00:00Z" },
                end: { dateTime: "2024-01-15T11:00:00Z" },
              },
            ],
          }),
        ),
      );

    const result = await searchEvents.execute({ query: "Team Meeting" });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("q=Team+Meeting");
    expect(result).toContain("Team Meeting");
  });

  it("returns message when no events match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] })),
    );

    const result = await searchEvents.execute({ query: "nonexistent" });
    expect(result).toContain('No events found matching "nonexistent"');
  });

  it("has query as required in parameters schema", () => {
    expect(searchEvents.parameters.required).toEqual(["query"]);
  });
});

// ---------------------------------------------------------------------------
// calendar_list_calendars
// ---------------------------------------------------------------------------

describe("calendar_list_calendars", () => {
  let tools: AgentTool[];
  let listCalendars: AgentTool;
  let mockAuth: GoogleAuth;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createCalendarTools(mockAuth);
    listCalendars = getTool(tools, "calendar_list_calendars");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns formatted calendar list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              summary: "My Calendar",
              id: "user@gmail.com",
              primary: true,
            },
            {
              summary: "Work",
              id: "work@group.calendar.google.com",
            },
          ],
        }),
      ),
    );

    const result = await listCalendars.execute({});

    expect(result).toContain("My Calendar (user@gmail.com) [primary]");
    expect(result).toContain("Work (work@group.calendar.google.com)");
    expect(result).not.toContain("Work (work@group.calendar.google.com) [primary]");
  });

  it("returns message when no calendars found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] })),
    );

    const result = await listCalendars.execute({});
    expect(result).toBe("No calendars found.");
  });

  it("calls correct API endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] })),
      );

    await listCalendars.execute({});

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/users/me/calendarList");
  });
});

// ---------------------------------------------------------------------------
// calendar_get_freebusy
// ---------------------------------------------------------------------------

describe("calendar_get_freebusy", () => {
  let tools: AgentTool[];
  let freebusy: AgentTool;
  let mockAuth: GoogleAuth;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createCalendarTools(mockAuth);
    freebusy = getTool(tools, "calendar_get_freebusy");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires timeMin parameter", async () => {
    await expect(
      freebusy.execute({ timeMax: "2024-01-15T18:00:00Z" }),
    ).rejects.toThrow("timeMin is required");
  });

  it("requires timeMax parameter", async () => {
    await expect(
      freebusy.execute({ timeMin: "2024-01-15T08:00:00Z" }),
    ).rejects.toThrow("timeMax is required");
  });

  it("returns busy periods per calendar", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            calendars: {
              primary: {
                busy: [
                  {
                    start: "2024-01-15T09:00:00Z",
                    end: "2024-01-15T10:00:00Z",
                  },
                  {
                    start: "2024-01-15T14:00:00Z",
                    end: "2024-01-15T15:00:00Z",
                  },
                ],
              },
            },
          }),
        ),
      );

    const result = await freebusy.execute({
      timeMin: "2024-01-15T08:00:00Z",
      timeMax: "2024-01-15T18:00:00Z",
    });

    expect(result).toContain("Calendar: primary");
    expect(result).toContain("Busy: 2024-01-15T09:00:00Z → 2024-01-15T10:00:00Z");
    expect(result).toContain("Busy: 2024-01-15T14:00:00Z → 2024-01-15T15:00:00Z");

    // Verify POST body
    const fetchCall = fetchSpy.mock.calls[0];
    const requestInit = fetchCall[1] as RequestInit;
    expect(requestInit.method).toBe("POST");
    const body = JSON.parse(requestInit.body as string);
    expect(body.items).toEqual([{ id: "primary" }]);
  });

  it("handles calendar with no busy periods", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          calendars: {
            primary: { busy: [] },
          },
        }),
      ),
    );

    const result = await freebusy.execute({
      timeMin: "2024-01-15T08:00:00Z",
      timeMax: "2024-01-15T18:00:00Z",
    });

    expect(result).toContain("No busy periods.");
  });

  it("sends custom calendarIds in request body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            calendars: {
              "cal1@example.com": { busy: [] },
              "cal2@example.com": { busy: [] },
            },
          }),
        ),
      );

    await freebusy.execute({
      timeMin: "2024-01-15T08:00:00Z",
      timeMax: "2024-01-15T18:00:00Z",
      calendarIds: ["cal1@example.com", "cal2@example.com"],
    });

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.items).toEqual([
      { id: "cal1@example.com" },
      { id: "cal2@example.com" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// calendar_create_event
// ---------------------------------------------------------------------------

describe("calendar_create_event", () => {
  let tools: AgentTool[];
  let createEvent: AgentTool;
  let mockAuth: GoogleAuth;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createCalendarTools(mockAuth);
    createEvent = getTool(tools, "calendar_create_event");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires summary parameter", async () => {
    await expect(
      createEvent.execute({
        summary: "",
        start: "2024-01-15T09:00:00Z",
        end: "2024-01-15T10:00:00Z",
      }),
    ).rejects.toThrow("summary is required");
  });

  it("requires start parameter", async () => {
    await expect(
      createEvent.execute({
        summary: "Meeting",
        start: "",
        end: "2024-01-15T10:00:00Z",
      }),
    ).rejects.toThrow("start is required");
  });

  it("requires end parameter", async () => {
    await expect(
      createEvent.execute({
        summary: "Meeting",
        start: "2024-01-15T09:00:00Z",
        end: "",
      }),
    ).rejects.toThrow("end is required");
  });

  it("creates event and returns confirmation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "abc123",
          summary: "Team Meeting",
          htmlLink: "https://calendar.google.com/event?eid=abc123",
        }),
      ),
    );

    const result = await createEvent.execute({
      summary: "Team Meeting",
      start: "2024-01-15T09:00:00Z",
      end: "2024-01-15T10:00:00Z",
    });

    expect(result).toContain("Event created: Team Meeting (abc123)");
    expect(result).toContain(
      "Link: https://calendar.google.com/event?eid=abc123",
    );
  });

  it("sends correct event body for timed event", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "e1", summary: "Test" })),
      );

    await createEvent.execute({
      summary: "Test Event",
      start: "2024-01-15T09:00:00Z",
      end: "2024-01-15T10:00:00Z",
      description: "A test event",
      location: "Conference Room",
      timeZone: "America/New_York",
    });

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(requestInit.method).toBe("POST");
    const body = JSON.parse(requestInit.body as string);
    expect(body.summary).toBe("Test Event");
    expect(body.start).toEqual({
      dateTime: "2024-01-15T09:00:00Z",
      timeZone: "America/New_York",
    });
    expect(body.end).toEqual({
      dateTime: "2024-01-15T10:00:00Z",
      timeZone: "America/New_York",
    });
    expect(body.description).toBe("A test event");
    expect(body.location).toBe("Conference Room");
  });

  it("creates all-day event with date fields", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "e2", summary: "Holiday" })),
      );

    await createEvent.execute({
      summary: "Holiday",
      start: "2024-12-25",
      end: "2024-12-26",
      allDay: true,
    });

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.start).toEqual({ date: "2024-12-25" });
    expect(body.end).toEqual({ date: "2024-12-26" });
  });

  it("parses comma-separated attendees", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "e3", summary: "Meeting" })),
      );

    await createEvent.execute({
      summary: "Meeting",
      start: "2024-01-15T09:00:00Z",
      end: "2024-01-15T10:00:00Z",
      attendees: "alice@example.com, bob@example.com, charlie@example.com",
    });

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.attendees).toEqual([
      { email: "alice@example.com" },
      { email: "bob@example.com" },
      { email: "charlie@example.com" },
    ]);
  });

  it("has summary, start, end as required parameters", () => {
    expect(createEvent.parameters.required).toEqual([
      "summary",
      "start",
      "end",
    ]);
  });
});

// ---------------------------------------------------------------------------
// calendar_update_event
// ---------------------------------------------------------------------------

describe("calendar_update_event", () => {
  let tools: AgentTool[];
  let updateEvent: AgentTool;
  let mockAuth: GoogleAuth;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createCalendarTools(mockAuth);
    updateEvent = getTool(tools, "calendar_update_event");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires eventId parameter", async () => {
    await expect(updateEvent.execute({})).rejects.toThrow(
      "eventId is required",
    );
  });

  it("requires non-empty eventId", async () => {
    await expect(updateEvent.execute({ eventId: "" })).rejects.toThrow(
      "eventId is required",
    );
  });

  it("sends PATCH request with updated fields", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "evt123", summary: "Updated Meeting" }),
        ),
      );

    const result = await updateEvent.execute({
      eventId: "evt123",
      summary: "Updated Meeting",
      location: "Room 202",
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/events/evt123");

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(requestInit.method).toBe("PATCH");
    const body = JSON.parse(requestInit.body as string);
    expect(body.summary).toBe("Updated Meeting");
    expect(body.location).toBe("Room 202");

    expect(result).toContain("Event updated: Updated Meeting (evt123)");
  });

  it("only includes provided fields in body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "evt456", summary: "Original Title" }),
        ),
      );

    await updateEvent.execute({
      eventId: "evt456",
      description: "New description only",
    });

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body).toEqual({ description: "New description only" });
    expect(body).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("location");
  });

  it("updates attendees from comma-separated string", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "evt789", summary: "Meeting" }),
        ),
      );

    await updateEvent.execute({
      eventId: "evt789",
      attendees: "new@example.com, other@example.com",
    });

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.attendees).toEqual([
      { email: "new@example.com" },
      { email: "other@example.com" },
    ]);
  });

  it("has eventId as required parameter", () => {
    expect(updateEvent.parameters.required).toEqual(["eventId"]);
  });
});

// ---------------------------------------------------------------------------
// calendar_delete_event
// ---------------------------------------------------------------------------

describe("calendar_delete_event", () => {
  let tools: AgentTool[];
  let deleteEvent: AgentTool;
  let mockAuth: GoogleAuth;

  beforeEach(() => {
    mockAuth = createMockAuth();
    tools = createCalendarTools(mockAuth);
    deleteEvent = getTool(tools, "calendar_delete_event");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires eventId parameter", async () => {
    await expect(deleteEvent.execute({})).rejects.toThrow(
      "eventId is required",
    );
  });

  it("requires non-empty eventId", async () => {
    await expect(deleteEvent.execute({ eventId: "" })).rejects.toThrow(
      "eventId is required",
    );
  });

  it("handles 204 No Content response", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await deleteEvent.execute({ eventId: "evt-delete-me" });

    expect(result).toBe("Event deleted: evt-delete-me");

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/events/evt-delete-me");

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(requestInit.method).toBe("DELETE");
  });

  it("uses primary as default calendarId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteEvent.execute({ eventId: "evt1" });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/calendars/primary/events/");
  });

  it("uses custom calendarId when provided", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteEvent.execute({
      eventId: "evt1",
      calendarId: "work@example.com",
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/calendars/work%40example.com/events/");
  });

  it("throws on HTTP error from delete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      deleteEvent.execute({ eventId: "nonexistent" }),
    ).rejects.toThrow("Google API 404");
  });

  it("passes auth token in Authorization header", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteEvent.execute({ eventId: "evt1" });

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mock-token");
  });
});

// ---------------------------------------------------------------------------
// Shared behavior
// ---------------------------------------------------------------------------

describe("calendar tools shared behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes auth token in Authorization header via callGoogleApi", async () => {
    const mockAuth = createMockAuth();
    const tools = createCalendarTools(mockAuth);
    const listEvents = getTool(tools, "calendar_list_events");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] })),
      );

    await listEvents.execute({});

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mock-token");
  });

  it("throws on HTTP error response", async () => {
    const mockAuth = createMockAuth();
    const tools = createCalendarTools(mockAuth);
    const listCalendars = getTool(tools, "calendar_list_calendars");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    await expect(listCalendars.execute({})).rejects.toThrow(
      "Google API 403",
    );
  });

  it("truncates very large responses", async () => {
    const mockAuth = createMockAuth();
    const tools = createCalendarTools(mockAuth);
    const listEvents = getTool(tools, "calendar_list_events");

    // Create a response with many events that will exceed 16000 chars
    const manyEvents = Array.from({ length: 500 }, (_, i) => ({
      summary: `Event ${i + 1}: ${"X".repeat(100)}`,
      start: { dateTime: "2024-01-15T09:00:00Z" },
      end: { dateTime: "2024-01-15T10:00:00Z" },
      location: `Location ${"Y".repeat(50)}`,
    }));

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ items: manyEvents })),
    );

    const result = await listEvents.execute({ maxResults: 500 });

    expect(result).toContain("[Truncated");
    expect(result).toContain("chars total");
  });

  it("includes User-Agent header in callGoogleApi requests", async () => {
    const mockAuth = createMockAuth();
    const tools = createCalendarTools(mockAuth);
    const listCalendars = getTool(tools, "calendar_list_calendars");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] })),
      );

    await listCalendars.execute({});

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Haya/0.1");
  });
});
