import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createWeatherTools,
  weatherCodeToDescription,
  degreesToCompass,
} from "./weather-tools.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const geocodingResponse = {
  results: [
    {
      name: "Tokyo",
      latitude: 35.6762,
      longitude: 139.6503,
      country: "Japan",
    },
  ],
};

const forecastResponse = {
  current: {
    temperature_2m: 22,
    relative_humidity_2m: 65,
    apparent_temperature: 20,
    precipitation: 0,
    weather_code: 2,
    wind_speed_10m: 15,
    wind_direction_10m: 315,
  },
  daily: {
    time: ["2025-06-02", "2025-06-03", "2025-06-04"],
    weather_code: [0, 2, 63],
    temperature_2m_max: [25, 23, 20],
    temperature_2m_min: [18, 16, 15],
    precipitation_sum: [0, 2, 8],
  },
};

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createWeatherTools", () => {
  it("returns one tool named weather", () => {
    const tools = createWeatherTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("weather");
  });

  it("tool has required fields", () => {
    const tools = createWeatherTools();
    const tool = tools[0];
    expect(tool.description).toBeTruthy();
    expect(tool.defaultPolicy).toBe("allow");
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// weather tool
// ---------------------------------------------------------------------------

describe("weather", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(...responses: unknown[]) {
    const fn = globalThis.fetch as ReturnType<typeof vi.fn>;
    for (const resp of responses) {
      fn.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(resp),
      });
    }
  }

  it("geocodes city name then fetches weather", async () => {
    mockFetch(geocodingResponse, forecastResponse);

    const tools = createWeatherTools();
    const result = await tools[0].execute({ city: "Tokyo" });

    // Should have made two fetch calls: geocoding + weather
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // First call should be geocoding
    const geoCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(geoCall).toContain("geocoding-api.open-meteo.com");
    expect(geoCall).toContain("name=Tokyo");

    // Second call should be weather
    const weatherCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as string;
    expect(weatherCall).toContain("api.open-meteo.com/v1/forecast");
    expect(weatherCall).toContain("latitude=35.6762");
    expect(weatherCall).toContain("longitude=139.6503");

    expect(result).toContain("Weather for Tokyo, Japan");
    expect(result).toContain("Temperature: 22°C (feels like 20°C)");
    expect(result).toContain("Humidity: 65%");
    expect(result).toContain("Wind: 15 km/h NW");
    expect(result).toContain("Precipitation: 0 mm");
    expect(result).toContain("Conditions: Partly cloudy");
  });

  it("fetches weather directly with lat/lng (no geocoding)", async () => {
    mockFetch(forecastResponse);

    const tools = createWeatherTools();
    const result = await tools[0].execute({
      latitude: 35.6762,
      longitude: 139.6503,
    });

    // Should have made only one fetch call: weather
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const weatherCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(weatherCall).toContain("api.open-meteo.com/v1/forecast");

    expect(result).toContain("Temperature: 22°C");
    expect(result).toContain("Current conditions:");
  });

  it("throws error when neither city nor lat/lng provided", async () => {
    const tools = createWeatherTools();
    await expect(tools[0].execute({})).rejects.toThrow(
      "Provide either latitude/longitude or a city name.",
    );
  });

  it("throws error when geocoding returns no results", async () => {
    const fn = globalThis.fetch as ReturnType<typeof vi.fn>;
    fn.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ results: [] }),
    });

    const tools = createWeatherTools();
    await expect(tools[0].execute({ city: "Nonexistent" })).rejects.toThrow(
      "No location found for city: Nonexistent",
    );
  });

  it("throws error on geocoding API failure", async () => {
    const fn = globalThis.fetch as ReturnType<typeof vi.fn>;
    fn.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tools = createWeatherTools();
    await expect(tools[0].execute({ city: "Tokyo" })).rejects.toThrow(
      "Geocoding API HTTP 500",
    );
  });

  it("throws error on weather API failure", async () => {
    const fn = globalThis.fetch as ReturnType<typeof vi.fn>;
    fn.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(geocodingResponse),
    });
    fn.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const tools = createWeatherTools();
    await expect(tools[0].execute({ city: "Tokyo" })).rejects.toThrow(
      "Weather API HTTP 503",
    );
  });

  it("formats 3-day forecast correctly", async () => {
    mockFetch(forecastResponse);

    const tools = createWeatherTools();
    const result = await tools[0].execute({
      latitude: 35.6762,
      longitude: 139.6503,
    });

    expect(result).toContain("3-day forecast:");
    expect(result).toContain("18-25°C");
    expect(result).toContain("Clear sky");
    expect(result).toContain("16-23°C");
    expect(result).toContain("Partly cloudy");
    expect(result).toContain("15-20°C");
    expect(result).toContain("Moderate rain");
    expect(result).toContain("0mm rain");
    expect(result).toContain("2mm rain");
    expect(result).toContain("8mm rain");
  });

  it("handles fetch network error", async () => {
    const fn = globalThis.fetch as ReturnType<typeof vi.fn>;
    fn.mockRejectedValueOnce(new Error("Network error"));

    const tools = createWeatherTools();
    await expect(
      tools[0].execute({ latitude: 0, longitude: 0 }),
    ).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// weatherCodeToDescription
// ---------------------------------------------------------------------------

describe("weatherCodeToDescription", () => {
  it("maps exact codes", () => {
    expect(weatherCodeToDescription(0)).toBe("Clear sky");
    expect(weatherCodeToDescription(2)).toBe("Partly cloudy");
    expect(weatherCodeToDescription(45)).toBe("Fog");
    expect(weatherCodeToDescription(63)).toBe("Moderate rain");
    expect(weatherCodeToDescription(95)).toBe("Thunderstorm");
  });

  it("maps range codes via fallback", () => {
    expect(weatherCodeToDescription(52)).toBe("Drizzle");
    expect(weatherCodeToDescription(62)).toBe("Rain");
    expect(weatherCodeToDescription(72)).toBe("Snow");
    expect(weatherCodeToDescription(81)).toBe("Moderate showers");
    expect(weatherCodeToDescription(97)).toBe("Thunderstorm");
  });

  it("returns unknown for unrecognized codes", () => {
    expect(weatherCodeToDescription(200)).toContain("Unknown");
    expect(weatherCodeToDescription(200)).toContain("200");
  });
});

// ---------------------------------------------------------------------------
// degreesToCompass
// ---------------------------------------------------------------------------

describe("degreesToCompass", () => {
  it("maps cardinal directions", () => {
    expect(degreesToCompass(0)).toBe("N");
    expect(degreesToCompass(90)).toBe("E");
    expect(degreesToCompass(180)).toBe("S");
    expect(degreesToCompass(270)).toBe("W");
  });

  it("maps intercardinal directions", () => {
    expect(degreesToCompass(45)).toBe("NE");
    expect(degreesToCompass(135)).toBe("SE");
    expect(degreesToCompass(225)).toBe("SW");
    expect(degreesToCompass(315)).toBe("NW");
  });

  it("handles 360 as N", () => {
    expect(degreesToCompass(360)).toBe("N");
  });

  it("handles negative degrees", () => {
    expect(degreesToCompass(-90)).toBe("W");
  });
});
