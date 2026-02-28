import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlightTools } from "./flight-tools.js";
import type { FlightProvider } from "./flight-tools.js";

vi.mock("../config/secrets.js", () => ({
  requireSecret: (envVar: string) => `mock-secret-${envVar}`,
}));

describe("createFlightTools", () => {
  it("returns one tool named flight_search", () => {
    const tools = createFlightTools([
      { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("flight_search");
  });

  it("has required parameter fields", () => {
    const tools = createFlightTools([
      { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
    ]);
    const params = tools[0].parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.required).toEqual(["origin", "destination", "date"]);
    expect(params.properties).toHaveProperty("origin");
    expect(params.properties).toHaveProperty("destination");
    expect(params.properties).toHaveProperty("date");
    expect(params.properties).toHaveProperty("return_date");
    expect(params.properties).toHaveProperty("adults");
    expect(params.properties).toHaveProperty("max_results");
  });

  it("has defaultPolicy allow", () => {
    const tools = createFlightTools([
      { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
    ]);
    expect(tools[0].defaultPolicy).toBe("allow");
  });
});

describe("flight_search (serpapi)", () => {
  const providers: FlightProvider[] = [
    { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
  ];

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct URL and params", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ best_flights: [], other_flights: [] }),
    });

    const [tool] = createFlightTools(providers);
    await tool.execute({ origin: "sfo", destination: "nrt", date: "2026-03-15" });

    const calledUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe("https://serpapi.com/search");
    expect(calledUrl.searchParams.get("engine")).toBe("google_flights");
    expect(calledUrl.searchParams.get("departure_id")).toBe("SFO");
    expect(calledUrl.searchParams.get("arrival_id")).toBe("NRT");
    expect(calledUrl.searchParams.get("outbound_date")).toBe("2026-03-15");
    expect(calledUrl.searchParams.get("type")).toBe("2"); // one-way
    expect(calledUrl.searchParams.get("adults")).toBe("1");
    expect(calledUrl.searchParams.get("api_key")).toBe("mock-secret-SERPAPI_KEY");
  });

  it("sets return_date when provided (round trip)", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ best_flights: [], other_flights: [] }),
    });

    const [tool] = createFlightTools(providers);
    await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
      return_date: "2026-03-22",
    });

    const calledUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("return_date")).toBe("2026-03-22");
    expect(calledUrl.searchParams.has("type")).toBe(false);
  });

  it("formats results correctly", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        best_flights: [
          {
            flights: [
              {
                airline: "United Airlines",
                flight_number: "UA837",
                departure_airport: { id: "SFO", time: "11:00" },
                arrival_airport: { id: "NRT", time: "15:30+1" },
              },
            ],
            total_duration: 690,
            price: 850,
          },
        ],
        other_flights: [
          {
            flights: [
              {
                airline: "Delta",
                flight_number: "DL275",
                departure_airport: { id: "SFO", time: "08:00" },
                arrival_airport: { id: "SEA", time: "10:00" },
              },
              {
                airline: "Delta",
                flight_number: "DL55",
                departure_airport: { id: "SEA", time: "12:00" },
                arrival_airport: { id: "NRT", time: "19:00+1" },
              },
            ],
            total_duration: 840,
            price: 780,
          },
        ],
      }),
    });

    const [tool] = createFlightTools(providers);
    const result = await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });

    expect(result).toContain("Flight Search: SFO → NRT (2026-03-15)");
    expect(result).toContain("1. United Airlines UA837");
    expect(result).toContain("11h 30m");
    expect(result).toContain("Nonstop");
    expect(result).toContain("$850 USD");
    expect(result).toContain("2. Delta DL275");
    expect(result).toContain("1 stop");
    expect(result).toContain("$780 USD");
  });

  it("handles API errors", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ origin: "SFO", destination: "NRT", date: "2026-03-15" }),
    ).rejects.toThrow("SerpApi HTTP 429");
  });

  it("handles SerpApi error field", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "Invalid API key" }),
    });

    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ origin: "SFO", destination: "NRT", date: "2026-03-15" }),
    ).rejects.toThrow("SerpApi error: Invalid API key");
  });

  it("returns empty message for no results", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ best_flights: [], other_flights: [] }),
    });

    const [tool] = createFlightTools(providers);
    const result = await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });
    expect(result).toContain("No flights found");
  });

  it("uppercases and trims origin/destination", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ best_flights: [], other_flights: [] }),
    });

    const [tool] = createFlightTools(providers);
    await tool.execute({ origin: " sfo ", destination: " nrt ", date: "2026-03-15" });

    const calledUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("departure_id")).toBe("SFO");
    expect(calledUrl.searchParams.get("arrival_id")).toBe("NRT");
  });

  it("throws when origin is missing", async () => {
    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ destination: "NRT", date: "2026-03-15" }),
    ).rejects.toThrow("origin is required");
  });

  it("throws when destination is missing", async () => {
    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ origin: "SFO", date: "2026-03-15" }),
    ).rejects.toThrow("destination is required");
  });

  it("throws when date is missing", async () => {
    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ origin: "SFO", destination: "NRT" }),
    ).rejects.toThrow("date is required");
  });
});

describe("flight_search (amadeus)", () => {
  const providers: FlightProvider[] = [
    {
      provider: "amadeus",
      apiKeyEnvVar: "AMADEUS_CLIENT_ID",
      apiSecretEnvVar: "AMADEUS_CLIENT_SECRET",
      environment: "test",
    },
  ];

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes OAuth2 token request then search request", async () => {
    // First call: token
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "test-token-123" }),
    });
    // Second call: search
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            itineraries: [
              {
                duration: "PT11H30M",
                segments: [
                  {
                    departure: { iataCode: "SFO", at: "2026-03-15T11:00:00" },
                    arrival: { iataCode: "NRT", at: "2026-03-16T15:30:00" },
                    carrierCode: "UA",
                    number: "837",
                  },
                ],
              },
            ],
            price: { grandTotal: "850.00", currency: "USD" },
          },
        ],
        dictionaries: { carriers: { UA: "United Airlines" } },
      }),
    });

    const [tool] = createFlightTools(providers);
    const result = await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });

    // Verify token request
    const tokenUrl = fetchSpy.mock.calls[0][0];
    expect(tokenUrl).toBe("https://test.api.amadeus.com/v1/security/oauth2/token");
    const tokenOpts = fetchSpy.mock.calls[0][1];
    expect(tokenOpts.method).toBe("POST");

    // Verify search request
    const searchUrl = new URL(fetchSpy.mock.calls[1][0]);
    expect(searchUrl.pathname).toBe("/v2/shopping/flight-offers");
    expect(searchUrl.searchParams.get("originLocationCode")).toBe("SFO");
    expect(searchUrl.searchParams.get("destinationLocationCode")).toBe("NRT");
    const searchOpts = fetchSpy.mock.calls[1][1];
    expect(searchOpts.headers.Authorization).toBe("Bearer test-token-123");

    // Verify formatted output
    expect(result).toContain("United Airlines UA837");
    expect(result).toContain("11h 30m");
    expect(result).toContain("$850 USD");
  });

  it("uses production URL when environment is production", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "prod-token" }),
    });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const prodProviders: FlightProvider[] = [
      {
        provider: "amadeus",
        apiKeyEnvVar: "AMADEUS_CLIENT_ID",
        apiSecretEnvVar: "AMADEUS_CLIENT_SECRET",
        environment: "production",
      },
    ];

    const [tool] = createFlightTools(prodProviders);
    await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });

    expect(fetchSpy.mock.calls[0][0]).toContain("api.amadeus.com");
    expect(fetchSpy.mock.calls[0][0]).not.toContain("test.");
  });

  it("parses ISO 8601 duration correctly", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok" }),
    });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            itineraries: [
              {
                duration: "PT2H45M",
                segments: [
                  {
                    departure: { iataCode: "LAX", at: "10:00" },
                    arrival: { iataCode: "SFO", at: "12:45" },
                    carrierCode: "AA",
                    number: "100",
                  },
                ],
              },
            ],
            price: { grandTotal: "120.00", currency: "USD" },
          },
        ],
        dictionaries: { carriers: { AA: "American Airlines" } },
      }),
    });

    const [tool] = createFlightTools(providers);
    const result = await tool.execute({
      origin: "LAX",
      destination: "SFO",
      date: "2026-04-01",
    });

    expect(result).toContain("2h 45m");
  });

  it("handles token fetch errors", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ origin: "SFO", destination: "NRT", date: "2026-03-15" }),
    ).rejects.toThrow("Amadeus token HTTP 401");
  });

  it("handles Amadeus API errors", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok" }),
    });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        errors: [{ detail: "No flight found for given criteria" }],
      }),
    });

    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ origin: "SFO", destination: "NRT", date: "2026-03-15" }),
    ).rejects.toThrow("Amadeus error: No flight found");
  });

  it("returns empty message for empty data", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok" }),
    });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const [tool] = createFlightTools(providers);
    const result = await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });
    expect(result).toContain("No flights found");
  });
});

describe("flight_search (tequila)", () => {
  const providers: FlightProvider[] = [
    { provider: "tequila", apiKeyEnvVar: "TEQUILA_API_KEY" },
  ];

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct URL with apikey header and DD/MM/YYYY dates", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const [tool] = createFlightTools(providers);
    await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });

    const calledUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      "https://tequila-api.kiwi.com/v2/search",
    );
    expect(calledUrl.searchParams.get("fly_from")).toBe("SFO");
    expect(calledUrl.searchParams.get("fly_to")).toBe("NRT");
    expect(calledUrl.searchParams.get("date_from")).toBe("15/03/2026");
    expect(calledUrl.searchParams.get("date_to")).toBe("15/03/2026");

    const opts = fetchSpy.mock.calls[0][1];
    expect(opts.headers.apikey).toBe("mock-secret-TEQUILA_API_KEY");
  });

  it("includes return dates when provided", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const [tool] = createFlightTools(providers);
    await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
      return_date: "2026-03-22",
    });

    const calledUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("return_from")).toBe("22/03/2026");
    expect(calledUrl.searchParams.get("return_to")).toBe("22/03/2026");
  });

  it("maps deep_link as bookingUrl", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            route: [
              {
                airline: "JL",
                flight_no: 1,
                flyFrom: "SFO",
                flyTo: "NRT",
                local_departure: "2026-03-15T10:00:00",
                local_arrival: "2026-03-16T14:00:00",
              },
            ],
            price: 750,
            deep_link: "https://kiwi.com/booking/abc",
            duration: { departure: 39600 },
            airlines: ["JL"],
          },
        ],
      }),
    });

    const [tool] = createFlightTools(providers);
    const result = await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });

    expect(result).toContain("Book: https://kiwi.com/booking/abc");
    expect(result).toContain("$750 USD");
    expect(result).toContain("11h");
  });

  it("handles Tequila API errors", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ origin: "SFO", destination: "NRT", date: "2026-03-15" }),
    ).rejects.toThrow("Tequila API HTTP 403");
  });

  it("handles Tequila error field", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "Unauthorized" }),
    });

    const [tool] = createFlightTools(providers);
    await expect(
      tool.execute({ origin: "SFO", destination: "NRT", date: "2026-03-15" }),
    ).rejects.toThrow("Tequila error: Unauthorized");
  });

  it("returns empty message for empty data", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const [tool] = createFlightTools(providers);
    const result = await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });
    expect(result).toContain("No flights found");
  });
});

describe("flight_search fallback chain", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to next provider on failure", async () => {
    // First provider (serpapi) fails
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    // Second provider (tequila) succeeds
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            route: [
              {
                airline: "JL",
                flight_no: 1,
                flyFrom: "SFO",
                flyTo: "NRT",
                local_departure: "10:00",
                local_arrival: "14:00+1",
              },
            ],
            price: 700,
            duration: { departure: 39600 },
            airlines: ["JL"],
          },
        ],
      }),
    });

    const [tool] = createFlightTools([
      { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
      { provider: "tequila", apiKeyEnvVar: "TEQUILA_KEY" },
    ]);

    const result = await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toContain("$700 USD");
  });

  it("throws last error when all providers fail", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const [tool] = createFlightTools([
      { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
      { provider: "tequila", apiKeyEnvVar: "TEQUILA_KEY" },
    ]);

    await expect(
      tool.execute({ origin: "SFO", destination: "NRT", date: "2026-03-15" }),
    ).rejects.toThrow("Tequila API HTTP 500");
  });

  it("stops on first success", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        best_flights: [
          {
            flights: [
              {
                airline: "UA",
                flight_number: "UA1",
                departure_airport: { id: "SFO", time: "10:00" },
                arrival_airport: { id: "NRT", time: "14:00" },
              },
            ],
            total_duration: 600,
            price: 900,
          },
        ],
        other_flights: [],
      }),
    });

    const [tool] = createFlightTools([
      { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
      { provider: "tequila", apiKeyEnvVar: "TEQUILA_KEY" },
    ]);

    const result = await tool.execute({
      origin: "SFO",
      destination: "NRT",
      date: "2026-03-15",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toContain("$900 USD");
  });
});
