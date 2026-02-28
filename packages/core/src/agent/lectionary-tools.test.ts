import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLectionaryTools } from "./lectionary-tools.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const todayResponse = {
  date: "2026-02-24",
  dayOfWeek: "Tuesday",
  tradition: "rcl",
  timestamp: "2026-02-24T00:00:00Z",
  dailyOffice: {
    morning: [
      {
        type: "Psalm",
        citation: "Psalm 51:1-17",
        text: "",
        isAlternative: false,
      },
      {
        type: "Old Testament",
        citation: "Joel 2:1-2,12-17",
        text: "",
        isAlternative: false,
      },
    ],
    evening: [
      {
        type: "Psalm",
        citation: "Psalm 103",
        text: "",
        isAlternative: false,
        office: "evening",
      },
      {
        type: "New Testament",
        citation: "Matthew 6:1-6,16-21",
        text: "",
        isAlternative: true,
        office: "evening",
      },
    ],
  },
  data: {
    id: "rcl-2026-02-24",
    date: "2026-02-24",
    traditionId: "rcl",
    season: "Lent",
    year: "A",
    dayName: "Ash Wednesday",
    liturgicalColor: "Purple",
    readings: [],
  },
};

const traditionsResponse = [
  {
    id: "rcl",
    name: "Revised Common Lectionary",
    description: "Used by many Protestant denominations",
  },
  {
    id: "catholic",
    name: "Roman Catholic Lectionary",
    description: "Used by the Catholic Church",
  },
  {
    id: "episcopal",
    name: "Episcopal Lectionary",
    description: "",
  },
];

const currentSeasonResponse = {
  name: "Lent",
  startDate: "2026-02-18",
  endDate: "2026-04-02",
  color: "Purple",
};

const yearSeasonsResponse = [
  {
    name: "Advent",
    startDate: "2026-11-29",
    endDate: "2026-12-24",
    color: "Blue",
  },
  {
    name: "Christmas",
    startDate: "2026-12-25",
    endDate: "2027-01-05",
    color: "White",
  },
  {
    name: "Lent",
    startDate: "2026-02-18",
    endDate: "2026-04-02",
    color: "Purple",
  },
];

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createLectionaryTools", () => {
  it("returns three tools", () => {
    const tools = createLectionaryTools();
    expect(tools).toHaveLength(3);
  });

  it("has lectionary_today, lectionary_traditions, and lectionary_calendar", () => {
    const tools = createLectionaryTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("lectionary_today");
    expect(names).toContain("lectionary_traditions");
    expect(names).toContain("lectionary_calendar");
  });

  it("all tools have defaultPolicy allow", () => {
    const tools = createLectionaryTools();
    for (const tool of tools) {
      expect(tool.defaultPolicy).toBe("allow");
    }
  });

  it("all tools have parameters and execute", () => {
    const tools = createLectionaryTools();
    for (const tool of tools) {
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// lectionary_today
// ---------------------------------------------------------------------------

describe("lectionary_today", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
  }

  function getTodayTool() {
    return createLectionaryTools().find((t) => t.name === "lectionary_today")!;
  }

  it("constructs URL for today with default tradition", async () => {
    mockFetch(todayResponse);
    const tool = getTodayTool();
    await tool.execute({});

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("lectio-api.org/api/v1/readings/today");
    expect(url).toContain("tradition=rcl");
  });

  it("constructs URL with specific date", async () => {
    mockFetch(todayResponse);
    const tool = getTodayTool();
    await tool.execute({ date: "2026-02-24" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("lectio-api.org/api/v1/readings");
    expect(url).not.toContain("/today");
    expect(url).toContain("date=2026-02-24");
    expect(url).toContain("tradition=rcl");
  });

  it("uses custom tradition parameter", async () => {
    mockFetch(todayResponse);
    const tool = getTodayTool();
    await tool.execute({ tradition: "catholic" });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("tradition=catholic");
  });

  it("formats response with day info and readings", async () => {
    mockFetch(todayResponse);
    const tool = getTodayTool();
    const result = await tool.execute({});

    expect(result).toContain("Lectionary Readings — Tuesday, 2026-02-24");
    expect(result).toContain("Tradition: RCL");
    expect(result).toContain("Day: Ash Wednesday");
    expect(result).toContain("Season: Lent");
    expect(result).toContain("Liturgical Color: Purple");
  });

  it("includes morning readings", async () => {
    mockFetch(todayResponse);
    const tool = getTodayTool();
    const result = await tool.execute({});

    expect(result).toContain("Morning Readings:");
    expect(result).toContain("Psalm: Psalm 51:1-17");
    expect(result).toContain("Old Testament: Joel 2:1-2,12-17");
  });

  it("includes evening readings", async () => {
    mockFetch(todayResponse);
    const tool = getTodayTool();
    const result = await tool.execute({});

    expect(result).toContain("Evening Readings:");
    expect(result).toContain("Psalm: Psalm 103");
    expect(result).toContain("New Testament: Matthew 6:1-6,16-21 (alternative)");
  });

  it("omits morning section when empty", async () => {
    const noMorning = {
      ...todayResponse,
      dailyOffice: { morning: [], evening: todayResponse.dailyOffice.evening },
    };
    mockFetch(noMorning);
    const tool = getTodayTool();
    const result = await tool.execute({});

    expect(result).not.toContain("Morning Readings:");
    expect(result).toContain("Evening Readings:");
  });

  it("omits evening section when empty", async () => {
    const noEvening = {
      ...todayResponse,
      dailyOffice: { morning: todayResponse.dailyOffice.morning, evening: [] },
    };
    mockFetch(noEvening);
    const tool = getTodayTool();
    const result = await tool.execute({});

    expect(result).toContain("Morning Readings:");
    expect(result).not.toContain("Evening Readings:");
  });

  it("omits optional fields when null", async () => {
    const minimal = {
      ...todayResponse,
      data: {
        ...todayResponse.data,
        season: null,
        liturgicalColor: null,
      },
    };
    mockFetch(minimal);
    const tool = getTodayTool();
    const result = await tool.execute({});

    expect(result).not.toContain("Season:");
    expect(result).not.toContain("Liturgical Color:");
    expect(result).toContain("Day: Ash Wednesday");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const tool = getTodayTool();
    await expect(tool.execute({})).rejects.toThrow(
      "Lectionary API HTTP 404",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getTodayTool();
    await expect(tool.execute({})).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// lectionary_traditions
// ---------------------------------------------------------------------------

describe("lectionary_traditions", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
  }

  function getTraditionsTool() {
    return createLectionaryTools().find(
      (t) => t.name === "lectionary_traditions",
    )!;
  }

  it("constructs correct URL", async () => {
    mockFetch(traditionsResponse);
    const tool = getTraditionsTool();
    await tool.execute({});

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("lectio-api.org/api/v1/traditions");
  });

  it("formats traditions list correctly", async () => {
    mockFetch(traditionsResponse);
    const tool = getTraditionsTool();
    const result = await tool.execute({});

    expect(result).toContain("Available Lectionary Traditions:");
    expect(result).toContain("- rcl: Revised Common Lectionary");
    expect(result).toContain("  Used by many Protestant denominations");
    expect(result).toContain("- catholic: Roman Catholic Lectionary");
    expect(result).toContain("- episcopal: Episcopal Lectionary");
  });

  it("omits description line when description is empty", async () => {
    mockFetch(traditionsResponse);
    const tool = getTraditionsTool();
    const result = await tool.execute({});

    // Episcopal has empty description, so there should be no indented line after it
    const lines = result.split("\n");
    const episcopalIdx = lines.findIndex((l: string) =>
      l.includes("episcopal: Episcopal Lectionary"),
    );
    expect(episcopalIdx).toBeGreaterThan(-1);
    // The next line should NOT be an indented description
    if (episcopalIdx < lines.length - 1) {
      expect(lines[episcopalIdx + 1]).not.toMatch(/^\s{2}\S/);
    }
  });

  it("returns friendly message when no traditions", async () => {
    mockFetch([]);
    const tool = getTraditionsTool();
    const result = await tool.execute({});

    expect(result).toContain("No traditions available.");
  });

  it("returns friendly message when response is not array", async () => {
    mockFetch({ error: "invalid" });
    const tool = getTraditionsTool();
    const result = await tool.execute({});

    expect(result).toContain("No traditions available.");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tool = getTraditionsTool();
    await expect(tool.execute({})).rejects.toThrow(
      "Lectionary API HTTP 500",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getTraditionsTool();
    await expect(tool.execute({})).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// lectionary_calendar
// ---------------------------------------------------------------------------

describe("lectionary_calendar", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
  }

  function getCalendarTool() {
    return createLectionaryTools().find(
      (t) => t.name === "lectionary_calendar",
    )!;
  }

  it("constructs URL for current season when no year provided", async () => {
    mockFetch(currentSeasonResponse);
    const tool = getCalendarTool();
    await tool.execute({});

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("lectio-api.org/api/v1/calendar/current");
  });

  it("constructs URL for specific year's seasons", async () => {
    mockFetch(yearSeasonsResponse);
    const tool = getCalendarTool();
    await tool.execute({ year: 2026 });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain("lectio-api.org/api/v1/calendar/2026/seasons");
  });

  it("formats current season response", async () => {
    mockFetch(currentSeasonResponse);
    const tool = getCalendarTool();
    const result = await tool.execute({});

    expect(result).toContain("Current Liturgical Season:");
    expect(result).toContain("Season: Lent");
    expect(result).toContain("Period: 2026-02-18 to 2026-04-02");
    expect(result).toContain("Color: Purple");
  });

  it("omits color when not present on current season", async () => {
    mockFetch({ ...currentSeasonResponse, color: "" });
    const tool = getCalendarTool();
    const result = await tool.execute({});

    expect(result).toContain("Current Liturgical Season:");
    expect(result).not.toContain("Color:");
  });

  it("formats year seasons list", async () => {
    mockFetch(yearSeasonsResponse);
    const tool = getCalendarTool();
    const result = await tool.execute({ year: 2026 });

    expect(result).toContain("Liturgical Seasons for 2026:");
    expect(result).toContain("- Advent (2026-11-29 to 2026-12-24)");
    expect(result).toContain("  Color: Blue");
    expect(result).toContain("- Christmas (2026-12-25 to 2027-01-05)");
    expect(result).toContain("  Color: White");
    expect(result).toContain("- Lent (2026-02-18 to 2026-04-02)");
    expect(result).toContain("  Color: Purple");
  });

  it("returns friendly message when no seasons for year", async () => {
    mockFetch([]);
    const tool = getCalendarTool();
    const result = await tool.execute({ year: 2026 });

    expect(result).toContain("No liturgical seasons found for 2026.");
  });

  it("throws on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const tool = getCalendarTool();
    await expect(tool.execute({})).rejects.toThrow(
      "Lectionary API HTTP 503",
    );
  });

  it("handles fetch network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const tool = getCalendarTool();
    await expect(tool.execute({})).rejects.toThrow("Network error");
  });
});
