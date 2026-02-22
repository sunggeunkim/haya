import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMapsTools } from "./maps-tools.js";
import type { AgentTool } from "./types.js";

// Helper to get a tool by name
function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createMapsTools", () => {
  it("returns exactly 3 tools", () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-key");
    const tools = createMapsTools("TEST_MAPS_KEY");
    expect(tools).toHaveLength(3);
    vi.unstubAllEnvs();
  });

  it("returns tools with expected names", () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-key");
    const tools = createMapsTools("TEST_MAPS_KEY");
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["maps_directions", "maps_distance", "maps_geocode"]);
    vi.unstubAllEnvs();
  });

  it("maps_directions has origin, destination, and mode parameters", () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-key");
    const tools = createMapsTools("TEST_MAPS_KEY");
    const directions = getTool(tools, "maps_directions");
    const props = directions.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("origin");
    expect(props).toHaveProperty("destination");
    expect(props).toHaveProperty("mode");
    expect(directions.parameters.required).toEqual(["origin", "destination"]);
    vi.unstubAllEnvs();
  });

  it("maps_distance has origins, destinations, and mode parameters", () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-key");
    const tools = createMapsTools("TEST_MAPS_KEY");
    const distance = getTool(tools, "maps_distance");
    const props = distance.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("origins");
    expect(props).toHaveProperty("destinations");
    expect(props).toHaveProperty("mode");
    expect(distance.parameters.required).toEqual(["origins", "destinations"]);
    vi.unstubAllEnvs();
  });

  it("maps_geocode has address and latlng parameters", () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-key");
    const tools = createMapsTools("TEST_MAPS_KEY");
    const geocode = getTool(tools, "maps_geocode");
    const props = geocode.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("address");
    expect(props).toHaveProperty("latlng");
    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------
// maps_directions
// ---------------------------------------------------------------------------

describe("maps_directions", () => {
  const ENV_VAR = "TEST_MAPS_KEY";
  let tools: AgentTool[];
  let directions: AgentTool;

  beforeEach(() => {
    vi.stubEnv(ENV_VAR, "fake-api-key");
    tools = createMapsTools(ENV_VAR);
    directions = getTool(tools, "maps_directions");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const successResponse = {
    status: "OK",
    routes: [
      {
        summary: "I-280 S",
        legs: [
          {
            distance: { text: "31.4 mi", value: 50534 },
            duration: { text: "35 mins", value: 2100 },
            steps: [
              {
                html_instructions:
                  "Head <b>south</b> on <b>4th St</b>",
                distance: { text: "0.2 mi", value: 322 },
              },
              {
                html_instructions:
                  "Turn <b>right</b> onto <b>Bryant St</b>",
                distance: { text: "0.1 mi", value: 161 },
              },
            ],
          },
        ],
      },
    ],
  };

  it("returns formatted directions on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(successResponse)),
    );

    const result = await directions.execute({
      origin: "San Francisco",
      destination: "San Jose",
    });

    expect(result).toContain("Route: I-280 S");
    expect(result).toContain("Distance: 31.4 mi");
    expect(result).toContain("Duration: 35 mins");
    expect(result).toContain("Steps:");
    expect(result).toContain("1. Head south on 4th St (0.2 mi)");
    expect(result).toContain("2. Turn right onto Bryant St (0.1 mi)");
    // HTML tags should be stripped
    expect(result).not.toContain("<b>");
    expect(result).not.toContain("</b>");
  });

  it("throws when origin is missing", async () => {
    await expect(
      directions.execute({ origin: "", destination: "B" }),
    ).rejects.toThrow("origin is required");
  });

  it("throws when destination is missing", async () => {
    await expect(
      directions.execute({ origin: "A", destination: "" }),
    ).rejects.toThrow("destination is required");
  });

  it("returns 'No route found' for ZERO_RESULTS", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "ZERO_RESULTS", routes: [] }),
      ),
    );

    const result = await directions.execute({
      origin: "A",
      destination: "B",
    });
    expect(result).toContain("No route found");
  });

  it("passes mode parameter to the API URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successResponse)),
      );

    await directions.execute({
      origin: "A",
      destination: "B",
      mode: "walking",
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("mode=walking");
  });
});

// ---------------------------------------------------------------------------
// maps_distance
// ---------------------------------------------------------------------------

describe("maps_distance", () => {
  const ENV_VAR = "TEST_MAPS_KEY";
  let tools: AgentTool[];
  let distance: AgentTool;

  beforeEach(() => {
    vi.stubEnv(ENV_VAR, "fake-api-key");
    tools = createMapsTools(ENV_VAR);
    distance = getTool(tools, "maps_distance");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const successResponse = {
    status: "OK",
    origin_addresses: ["San Francisco, CA", "Boston, MA"],
    destination_addresses: ["Los Angeles, CA"],
    rows: [
      {
        elements: [
          {
            status: "OK",
            distance: { text: "382 mi" },
            duration: { text: "5 hours 45 mins" },
          },
        ],
      },
      {
        elements: [
          {
            status: "OK",
            distance: { text: "2,983 mi" },
            duration: { text: "1 day 19 hours" },
          },
        ],
      },
    ],
  };

  it("returns formatted multi-origin distance matrix", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(successResponse)),
    );

    const result = await distance.execute({
      origins: "San Francisco|Boston",
      destinations: "Los Angeles",
    });

    expect(result).toContain(
      "From San Francisco, CA to Los Angeles, CA: 382 mi, 5 hours 45 mins",
    );
    expect(result).toContain(
      "From Boston, MA to Los Angeles, CA: 2,983 mi, 1 day 19 hours",
    );
  });

  it("throws when origins is missing", async () => {
    await expect(
      distance.execute({ origins: "", destinations: "LA" }),
    ).rejects.toThrow("origins is required");
  });

  it("throws when destinations is missing", async () => {
    await expect(
      distance.execute({ origins: "SF", destinations: "" }),
    ).rejects.toThrow("destinations is required");
  });

  it("shows status text for non-OK element", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "OK",
          origin_addresses: ["Origin A"],
          destination_addresses: ["Destination B"],
          rows: [
            {
              elements: [
                { status: "NOT_FOUND" },
              ],
            },
          ],
        }),
      ),
    );

    const result = await distance.execute({
      origins: "Origin A",
      destinations: "Destination B",
    });

    expect(result).toContain("NOT_FOUND");
    expect(result).toContain("From Origin A to Destination B");
  });
});

// ---------------------------------------------------------------------------
// maps_geocode
// ---------------------------------------------------------------------------

describe("maps_geocode", () => {
  const ENV_VAR = "TEST_MAPS_KEY";
  let tools: AgentTool[];
  let geocode: AgentTool;

  beforeEach(() => {
    vi.stubEnv(ENV_VAR, "fake-api-key");
    tools = createMapsTools(ENV_VAR);
    geocode = getTool(tools, "maps_geocode");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const successResponse = {
    status: "OK",
    results: [
      {
        formatted_address:
          "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
        geometry: {
          location: { lat: 37.4224764, lng: -122.0842499 },
        },
      },
    ],
  };

  it("returns formatted address and coordinates for forward geocoding", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(successResponse)),
    );

    const result = await geocode.execute({
      address: "1600 Amphitheatre Parkway, Mountain View, CA",
    });

    expect(result).toContain(
      "Address: 1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
    );
    expect(result).toContain("Coordinates: 37.4224764, -122.0842499");
  });

  it("works for reverse geocoding with latlng", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successResponse)),
      );

    const result = await geocode.execute({
      latlng: "37.4224764,-122.0842499",
    });

    expect(result).toContain("Address:");
    expect(result).toContain("Coordinates:");

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("latlng=");
  });

  it("throws when both address and latlng are provided", async () => {
    await expect(
      geocode.execute({
        address: "Some address",
        latlng: "37.0,-122.0",
      }),
    ).rejects.toThrow("Provide either 'address' or 'latlng', not both.");
  });

  it("throws when neither address nor latlng is provided", async () => {
    await expect(geocode.execute({})).rejects.toThrow(
      "Either 'address' or 'latlng' is required.",
    );
  });

  it("returns 'No results found' for ZERO_RESULTS", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "ZERO_RESULTS", results: [] }),
      ),
    );

    const result = await geocode.execute({ address: "xyznonexistent" });
    expect(result).toContain("No results found");
  });
});

// ---------------------------------------------------------------------------
// Shared behavior
// ---------------------------------------------------------------------------

describe("maps tools shared behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("throws when API key env var is not set", async () => {
    // Ensure the env var is NOT set
    vi.stubEnv("MAPS_KEY_UNSET", "");
    delete process.env.MAPS_KEY_UNSET;

    const tools = createMapsTools("MAPS_KEY_UNSET");
    const directions = getTool(tools, "maps_directions");

    await expect(
      directions.execute({ origin: "A", destination: "B" }),
    ).rejects.toThrow(/not set or empty/);
  });

  it("throws on HTTP error response", async () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-api-key");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    const tools = createMapsTools("TEST_MAPS_KEY");
    const geocode = getTool(tools, "maps_geocode");

    await expect(
      geocode.execute({ address: "test" }),
    ).rejects.toThrow("Google Maps API HTTP 403");
  });

  it("throws on Google API error status like REQUEST_DENIED", async () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-api-key");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "REQUEST_DENIED",
          error_message: "The provided API key is invalid.",
        }),
      ),
    );

    const tools = createMapsTools("TEST_MAPS_KEY");
    const distance = getTool(tools, "maps_distance");

    await expect(
      distance.execute({ origins: "A", destinations: "B" }),
    ).rejects.toThrow("Google Maps API error: The provided API key is invalid.");
  });

  it("throws with status text when error_message is absent", async () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-api-key");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "OVER_QUERY_LIMIT" }),
      ),
    );

    const tools = createMapsTools("TEST_MAPS_KEY");
    const geocode = getTool(tools, "maps_geocode");

    await expect(
      geocode.execute({ address: "test" }),
    ).rejects.toThrow("Google Maps API error: OVER_QUERY_LIMIT");
  });

  it("truncates very large responses", async () => {
    vi.stubEnv("TEST_MAPS_KEY", "fake-api-key");

    // Create a response with many steps that will exceed 16000 chars
    const manySteps = Array.from({ length: 500 }, (_, i) => ({
      html_instructions: `Step ${i + 1}: ${"X".repeat(100)}`,
      distance: { text: "1.0 mi", value: 1609 },
    }));

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "OK",
          routes: [
            {
              summary: "Long Route",
              legs: [
                {
                  distance: { text: "500 mi", value: 804672 },
                  duration: { text: "8 hours", value: 28800 },
                  steps: manySteps,
                },
              ],
            },
          ],
        }),
      ),
    );

    const tools = createMapsTools("TEST_MAPS_KEY");
    const directions = getTool(tools, "maps_directions");
    const result = await directions.execute({
      origin: "A",
      destination: "B",
    });

    expect(result).toContain("[Truncated");
    expect(result).toContain("chars total");
  });
});
