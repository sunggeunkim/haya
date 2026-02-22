import { requireSecret } from "../config/secrets.js";
import type { AgentTool } from "./types.js";

const MAX_RESPONSE_LENGTH = 16_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAPS_API_BASE = "https://maps.googleapis.com/maps/api";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function callMapsApi(
  endpoint: string,
  params: Record<string, string>,
  apiKeyEnvVar: string,
): Promise<Record<string, unknown>> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(`${MAPS_API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "Haya/0.1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Google Maps API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const status = data.status as string;
  if (status !== "OK" && status !== "ZERO_RESULTS") {
    const errorMessage = (data.error_message as string) ?? status;
    throw new Error(`Google Maps API error: ${errorMessage}`);
  }
  return data;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function truncate(text: string): string {
  if (text.length > MAX_RESPONSE_LENGTH) {
    return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// maps_directions
// ---------------------------------------------------------------------------

function createDirectionsTool(apiKeyEnvVar: string): AgentTool {
  return {
    name: "maps_directions",
    description:
      "Get driving/walking/bicycling/transit directions between two locations. " +
      "Returns step-by-step route instructions with distances and durations.",
    parameters: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Starting location (address or place name)",
        },
        destination: {
          type: "string",
          description: "Ending location (address or place name)",
        },
        mode: {
          type: "string",
          enum: ["driving", "walking", "bicycling", "transit"],
          description: "Travel mode (default: driving)",
        },
      },
      required: ["origin", "destination"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const origin = args.origin as string;
      const destination = args.destination as string;
      if (!origin) throw new Error("origin is required");
      if (!destination) throw new Error("destination is required");

      const params: Record<string, string> = { origin, destination };
      if (args.mode) {
        params.mode = args.mode as string;
      }

      const data = await callMapsApi("directions/json", params, apiKeyEnvVar);

      if (data.status === "ZERO_RESULTS") {
        return `No route found between ${origin} and ${destination}.`;
      }

      const routes = data.routes as Array<Record<string, unknown>>;
      if (!routes || routes.length === 0) {
        return `No route found between ${origin} and ${destination}.`;
      }

      const legs = routes[0].legs as Array<Record<string, unknown>>;
      const leg = legs[0];
      const summary = routes[0].summary as string;
      const distance = leg.distance as { text: string };
      const duration = leg.duration as { text: string };
      const steps = leg.steps as Array<Record<string, unknown>>;

      const lines: string[] = [
        `Route: ${summary}`,
        `Distance: ${distance.text}`,
        `Duration: ${duration.text}`,
        "",
        "Steps:",
      ];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const instruction = stripHtml(step.html_instructions as string);
        const stepDistance = step.distance as { text: string };
        lines.push(`${i + 1}. ${instruction} (${stepDistance.text})`);
      }

      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// maps_distance
// ---------------------------------------------------------------------------

function createDistanceTool(apiKeyEnvVar: string): AgentTool {
  return {
    name: "maps_distance",
    description:
      "Calculate travel distance and duration between one or more origins and destinations. " +
      "Supports pipe-separated lists for matrix calculations.",
    parameters: {
      type: "object",
      properties: {
        origins: {
          type: "string",
          description:
            "One or more origin locations, separated by pipes (e.g. 'New York|Boston')",
        },
        destinations: {
          type: "string",
          description:
            "One or more destination locations, separated by pipes (e.g. 'Philadelphia|Washington DC')",
        },
        mode: {
          type: "string",
          enum: ["driving", "walking", "bicycling", "transit"],
          description: "Travel mode (default: driving)",
        },
      },
      required: ["origins", "destinations"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const origins = args.origins as string;
      const destinations = args.destinations as string;
      if (!origins) throw new Error("origins is required");
      if (!destinations) throw new Error("destinations is required");

      const params: Record<string, string> = { origins, destinations };
      if (args.mode) {
        params.mode = args.mode as string;
      }

      const data = await callMapsApi(
        "distancematrix/json",
        params,
        apiKeyEnvVar,
      );

      const originList = (data.origin_addresses as string[]) ?? [];
      const destList = (data.destination_addresses as string[]) ?? [];
      const rows = data.rows as Array<{
        elements: Array<{
          status: string;
          distance?: { text: string };
          duration?: { text: string };
        }>;
      }>;

      const lines: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        for (let j = 0; j < row.elements.length; j++) {
          const element = row.elements[j];
          const from = originList[i] ?? `Origin ${i + 1}`;
          const to = destList[j] ?? `Destination ${j + 1}`;

          if (element.status !== "OK") {
            lines.push(`From ${from} to ${to}: ${element.status}`);
          } else {
            lines.push(
              `From ${from} to ${to}: ${element.distance!.text}, ${element.duration!.text}`,
            );
          }
        }
      }

      return truncate(lines.join("\n"));
    },
  };
}

// ---------------------------------------------------------------------------
// maps_geocode
// ---------------------------------------------------------------------------

function createGeocodeTool(apiKeyEnvVar: string): AgentTool {
  return {
    name: "maps_geocode",
    description:
      "Convert an address to coordinates (geocode) or coordinates to an address (reverse geocode). " +
      "Provide either 'address' or 'latlng', not both.",
    parameters: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "Address to geocode (e.g. '1600 Amphitheatre Parkway, Mountain View, CA')",
        },
        latlng: {
          type: "string",
          description:
            "Coordinates to reverse geocode (e.g. '37.4224764,-122.0842499')",
        },
      },
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const address = args.address as string | undefined;
      const latlng = args.latlng as string | undefined;

      if (address && latlng) {
        throw new Error("Provide either 'address' or 'latlng', not both.");
      }
      if (!address && !latlng) {
        throw new Error("Either 'address' or 'latlng' is required.");
      }

      const params: Record<string, string> = {};
      if (address) params.address = address;
      if (latlng) params.latlng = latlng;

      const data = await callMapsApi("geocode/json", params, apiKeyEnvVar);

      if (data.status === "ZERO_RESULTS") {
        const query = address ?? latlng;
        return `No results found for "${query}".`;
      }

      const results = data.results as Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
      }>;

      if (!results || results.length === 0) {
        const query = address ?? latlng;
        return `No results found for "${query}".`;
      }

      const lines: string[] = [];
      for (const result of results) {
        const loc = result.geometry.location;
        lines.push(`Address: ${result.formatted_address}`);
        lines.push(`Coordinates: ${loc.lat}, ${loc.lng}`);
        lines.push("");
      }

      return truncate(lines.join("\n").trimEnd());
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createMapsTools(apiKeyEnvVar: string): AgentTool[] {
  return [
    createDirectionsTool(apiKeyEnvVar),
    createDistanceTool(apiKeyEnvVar),
    createGeocodeTool(apiKeyEnvVar),
  ];
}
