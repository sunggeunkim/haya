import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// ---------------------------------------------------------------------------
// WMO weather code descriptions
// ---------------------------------------------------------------------------

const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Slight showers",
  82: "Violent showers",
  81: "Moderate showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export function weatherCodeToDescription(code: number): string {
  if (WMO_CODES[code]) return WMO_CODES[code];
  if (code >= 1 && code <= 3) return "Partly cloudy";
  if (code >= 45 && code <= 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 71 && code <= 75) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return `Unknown (code ${code})`;
}

// ---------------------------------------------------------------------------
// Wind direction helper
// ---------------------------------------------------------------------------

export function degreesToCompass(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(normalized / 45) % 8;
  return directions[index];
}

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface GeocodingResult {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
  }>;
}

interface ForecastResponse {
  current?: {
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWeatherTools(): BuiltinTool[] {
  return [
    {
      name: "weather",
      description:
        "Get current weather and forecast for a location using the free Open-Meteo API. " +
        "No API key required. Provide latitude/longitude or a city name (which will be geocoded).",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          latitude: {
            type: "number",
            description: "Latitude of the location",
          },
          longitude: {
            type: "number",
            description: "Longitude of the location",
          },
          city: {
            type: "string",
            description:
              "Provide city name if lat/lng not known",
          },
        },
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        let lat = args.latitude as number | undefined;
        let lng = args.longitude as number | undefined;
        const city = args.city as string | undefined;

        if (lat == null && lng == null && !city) {
          throw new Error(
            "Provide either latitude/longitude or a city name.",
          );
        }

        let locationName = city ?? `${lat}, ${lng}`;

        // Geocode city name if lat/lng not provided
        if ((lat == null || lng == null) && city) {
          const geoUrl = `${GEOCODING_URL}?name=${encodeURIComponent(city)}&count=1`;
          const geoResponse = await fetch(geoUrl, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });

          if (!geoResponse.ok) {
            throw new Error(
              `Geocoding API HTTP ${geoResponse.status}: ${geoResponse.statusText}`,
            );
          }

          const geoData = (await geoResponse.json()) as GeocodingResult;
          if (!geoData.results || geoData.results.length === 0) {
            throw new Error(`No location found for city: ${city}`);
          }

          const location = geoData.results[0];
          lat = location.latitude;
          lng = location.longitude;
          locationName = location.country
            ? `${location.name}, ${location.country}`
            : location.name;
        }

        // Fetch weather forecast
        const weatherUrl =
          `${FORECAST_URL}?latitude=${lat}&longitude=${lng}` +
          "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
          "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum" +
          "&timezone=auto&forecast_days=3";

        const weatherResponse = await fetch(weatherUrl, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!weatherResponse.ok) {
          throw new Error(
            `Weather API HTTP ${weatherResponse.status}: ${weatherResponse.statusText}`,
          );
        }

        const data = (await weatherResponse.json()) as ForecastResponse;

        if (!data.current) {
          throw new Error("No current weather data available.");
        }

        const current = data.current;
        const windCompass = degreesToCompass(current.wind_direction_10m);
        const conditionText = weatherCodeToDescription(current.weather_code);

        const lines: string[] = [
          `Weather for ${locationName} (${lat}, ${lng}):`,
          "",
          "Current conditions:",
          `  Temperature: ${current.temperature_2m}\u00B0C (feels like ${current.apparent_temperature}\u00B0C)`,
          `  Humidity: ${current.relative_humidity_2m}%`,
          `  Wind: ${current.wind_speed_10m} km/h ${windCompass}`,
          `  Precipitation: ${current.precipitation} mm`,
          `  Conditions: ${conditionText}`,
        ];

        if (data.daily && data.daily.time.length > 0) {
          lines.push("");
          lines.push("3-day forecast:");
          for (let i = 0; i < data.daily.time.length; i++) {
            const date = new Date(data.daily.time[i]);
            const dayName = date.toLocaleDateString("en-US", {
              weekday: "short",
              timeZone: "UTC",
            });
            const minTemp = data.daily.temperature_2m_min[i];
            const maxTemp = data.daily.temperature_2m_max[i];
            const precip = data.daily.precipitation_sum[i];
            const code = data.daily.weather_code[i];
            const desc = weatherCodeToDescription(code);
            lines.push(
              `  ${dayName}: ${minTemp}-${maxTemp}\u00B0C, ${desc}, ${precip}mm rain`,
            );
          }
        }

        return lines.join("\n");
      },
    },
  ];
}
