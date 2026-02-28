import { requireSecret } from "../config/secrets.js";
import type { BuiltinTool } from "./builtin-tools.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search";
const AMADEUS_TEST_URL = "https://test.api.amadeus.com";
const AMADEUS_PROD_URL = "https://api.amadeus.com";
const TEQUILA_SEARCH_URL = "https://tequila-api.kiwi.com/v2/search";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_FLIGHT_RESULTS = 10;

/** Unified flight offer that all providers map into. */
interface FlightOffer {
  airline: string;
  flightNumber: string | null;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  price: number;
  currency: string;
  bookingUrl: string | null;
}

/** A single flight search provider entry. */
export interface FlightProvider {
  provider: "serpapi" | "amadeus" | "tequila";
  apiKeyEnvVar: string;
  apiSecretEnvVar?: string;
  environment?: "test" | "production";
}

// --- SerpApi response interfaces ---

interface SerpApiFlight {
  airline?: string;
  airline_logo?: string;
  flight_number?: string;
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
}

interface SerpApiFlightGroup {
  flights?: SerpApiFlight[];
  total_duration?: number;
  price?: number;
  type?: string;
  airline_logo?: string;
}

interface SerpApiResponse {
  best_flights?: SerpApiFlightGroup[];
  other_flights?: SerpApiFlightGroup[];
  search_metadata?: { status?: string };
  error?: string;
}

// --- Amadeus response interfaces ---

interface AmadeusSegment {
  departure?: { iataCode?: string; at?: string };
  arrival?: { iataCode?: string; at?: string };
  carrierCode?: string;
  number?: string;
  duration?: string;
}

interface AmadeusItinerary {
  duration?: string;
  segments?: AmadeusSegment[];
}

interface AmadeusOffer {
  itineraries?: AmadeusItinerary[];
  price?: { grandTotal?: string; currency?: string };
}

interface AmadeusResponse {
  data?: AmadeusOffer[];
  dictionaries?: { carriers?: Record<string, string> };
  errors?: Array<{ detail?: string }>;
}

interface AmadeusTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

// --- Tequila response interfaces ---

interface TequilaRoute {
  airline?: string;
  flight_no?: number;
  flyFrom?: string;
  flyTo?: string;
  local_departure?: string;
  local_arrival?: string;
}

interface TequilaFlight {
  route?: TequilaRoute[];
  price?: number;
  deep_link?: string;
  duration?: { departure?: number };
  airlines?: string[];
  flyFrom?: string;
  flyTo?: string;
  local_departure?: string;
  local_arrival?: string;
}

interface TequilaResponse {
  data?: TequilaFlight[];
  error?: string;
}

// --- Helpers ---

/** Format minutes into "Xh Ym" string. */
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Parse ISO 8601 duration (e.g. "PT11H30M") into total minutes. */
function parseIsoDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return 0;
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const mins = match[2] ? Number.parseInt(match[2], 10) : 0;
  return hours * 60 + mins;
}

/** Convert ISO date "2026-03-15" to Tequila DD/MM/YYYY format. */
function toTequilaDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// --- Provider execute functions ---

/** Execute a flight search against the SerpApi Google Flights endpoint. */
async function executeSerpApiFlightSearch(
  apiKeyEnvVar: string,
  origin: string,
  destination: string,
  date: string,
  returnDate: string | undefined,
  adults: number,
  maxResults: number,
): Promise<FlightOffer[]> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(SERPAPI_SEARCH_URL);
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", destination);
  url.searchParams.set("outbound_date", date);
  if (returnDate) {
    url.searchParams.set("return_date", returnDate);
  } else {
    url.searchParams.set("type", "2"); // one-way
  }
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `SerpApi HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as SerpApiResponse;
  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`);
  }

  const allFlights = [
    ...(data.best_flights ?? []),
    ...(data.other_flights ?? []),
  ];

  if (allFlights.length === 0) {
    return [];
  }

  const offers: FlightOffer[] = [];
  for (const group of allFlights.slice(0, maxResults)) {
    const segments = group.flights ?? [];
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (!first || !last) continue;

    offers.push({
      airline: first.airline ?? "Unknown",
      flightNumber: first.flight_number ?? null,
      origin: first.departure_airport?.id ?? origin,
      destination: last.arrival_airport?.id ?? destination,
      departureTime: first.departure_airport?.time ?? "",
      arrivalTime: last.arrival_airport?.time ?? "",
      duration: formatDuration(group.total_duration ?? 0),
      stops: Math.max(0, segments.length - 1),
      price: group.price ?? 0,
      currency: "USD",
      bookingUrl: null,
    });
  }

  return offers;
}

/** Fetch an OAuth2 bearer token from the Amadeus API. */
async function fetchAmadeusToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Amadeus token HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as AmadeusTokenResponse;
  if (data.error) {
    throw new Error(
      `Amadeus token error: ${data.error_description ?? data.error}`,
    );
  }
  if (!data.access_token) {
    throw new Error("Amadeus token response missing access_token");
  }

  return data.access_token;
}

/** Execute a flight search against the Amadeus Flight Offers endpoint. */
async function executeAmadeusFlightSearch(
  apiKeyEnvVar: string,
  apiSecretEnvVar: string,
  environment: "test" | "production",
  origin: string,
  destination: string,
  date: string,
  returnDate: string | undefined,
  adults: number,
  maxResults: number,
): Promise<FlightOffer[]> {
  const clientId = requireSecret(apiKeyEnvVar);
  const clientSecret = requireSecret(apiSecretEnvVar);
  const baseUrl = environment === "production" ? AMADEUS_PROD_URL : AMADEUS_TEST_URL;

  const token = await fetchAmadeusToken(baseUrl, clientId, clientSecret);

  const url = new URL(`${baseUrl}/v2/shopping/flight-offers`);
  url.searchParams.set("originLocationCode", origin);
  url.searchParams.set("destinationLocationCode", destination);
  url.searchParams.set("departureDate", date);
  if (returnDate) {
    url.searchParams.set("returnDate", returnDate);
  }
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("max", String(maxResults));

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Amadeus API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as AmadeusResponse;
  if (data.errors && data.errors.length > 0) {
    throw new Error(`Amadeus error: ${data.errors[0].detail ?? "Unknown"}`);
  }

  if (!data.data || data.data.length === 0) {
    return [];
  }

  const carriers = data.dictionaries?.carriers ?? {};
  const offers: FlightOffer[] = [];

  for (const offer of data.data.slice(0, maxResults)) {
    const itin = offer.itineraries?.[0];
    if (!itin) continue;
    const segments = itin.segments ?? [];
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (!first || !last) continue;

    const carrierCode = first.carrierCode ?? "";
    const airlineName = carriers[carrierCode] ?? carrierCode;
    const flightNum = first.number ? `${carrierCode}${first.number}` : null;

    offers.push({
      airline: airlineName,
      flightNumber: flightNum,
      origin: first.departure?.iataCode ?? origin,
      destination: last.arrival?.iataCode ?? destination,
      departureTime: first.departure?.at ?? "",
      arrivalTime: last.arrival?.at ?? "",
      duration: itin.duration ? formatDuration(parseIsoDuration(itin.duration)) : "",
      stops: Math.max(0, segments.length - 1),
      price: offer.price?.grandTotal ? Number.parseFloat(offer.price.grandTotal) : 0,
      currency: offer.price?.currency ?? "USD",
      bookingUrl: null,
    });
  }

  return offers;
}

/** Execute a flight search against the Tequila (Kiwi.com) endpoint. */
async function executeTequilaFlightSearch(
  apiKeyEnvVar: string,
  origin: string,
  destination: string,
  date: string,
  returnDate: string | undefined,
  adults: number,
  maxResults: number,
): Promise<FlightOffer[]> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(TEQUILA_SEARCH_URL);
  url.searchParams.set("fly_from", origin);
  url.searchParams.set("fly_to", destination);
  url.searchParams.set("date_from", toTequilaDate(date));
  url.searchParams.set("date_to", toTequilaDate(date));
  if (returnDate) {
    url.searchParams.set("return_from", toTequilaDate(returnDate));
    url.searchParams.set("return_to", toTequilaDate(returnDate));
  }
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("limit", String(maxResults));

  const response = await fetch(url.toString(), {
    headers: { apikey: apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Tequila API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as TequilaResponse;
  if (data.error) {
    throw new Error(`Tequila error: ${data.error}`);
  }

  if (!data.data || data.data.length === 0) {
    return [];
  }

  const offers: FlightOffer[] = [];

  for (const flight of data.data.slice(0, maxResults)) {
    const routes = flight.route ?? [];
    const first = routes[0];
    const last = routes[routes.length - 1];

    const durationMin = flight.duration?.departure
      ? Math.round(flight.duration.departure / 60)
      : 0;

    offers.push({
      airline: first?.airline ?? flight.airlines?.[0] ?? "Unknown",
      flightNumber: first?.flight_no ? String(first.flight_no) : null,
      origin: first?.flyFrom ?? flight.flyFrom ?? origin,
      destination: last?.flyTo ?? flight.flyTo ?? destination,
      departureTime: first?.local_departure ?? flight.local_departure ?? "",
      arrivalTime: last?.local_arrival ?? flight.local_arrival ?? "",
      duration: formatDuration(durationMin),
      stops: Math.max(0, routes.length - 1),
      price: flight.price ?? 0,
      currency: "USD",
      bookingUrl: flight.deep_link ?? null,
    });
  }

  return offers;
}

/** Dispatch a flight search request to the appropriate provider. */
async function executeFlightProvider(
  provider: FlightProvider,
  origin: string,
  destination: string,
  date: string,
  returnDate: string | undefined,
  adults: number,
  maxResults: number,
): Promise<FlightOffer[]> {
  if (provider.provider === "amadeus") {
    return executeAmadeusFlightSearch(
      provider.apiKeyEnvVar,
      provider.apiSecretEnvVar ?? provider.apiKeyEnvVar,
      provider.environment ?? "test",
      origin,
      destination,
      date,
      returnDate,
      adults,
      maxResults,
    );
  }
  if (provider.provider === "tequila") {
    return executeTequilaFlightSearch(
      provider.apiKeyEnvVar,
      origin,
      destination,
      date,
      returnDate,
      adults,
      maxResults,
    );
  }
  return executeSerpApiFlightSearch(
    provider.apiKeyEnvVar,
    origin,
    destination,
    date,
    returnDate,
    adults,
    maxResults,
  );
}

/** Format flight search results into a labeled text block. */
function formatFlightResults(
  offers: FlightOffer[],
  origin: string,
  destination: string,
  date: string,
): string {
  if (offers.length === 0) {
    return `Flight Search: ${origin} → ${destination} (${date})\n\nNo flights found.`;
  }

  const lines: string[] = [];
  lines.push(`Flight Search: ${origin} → ${destination} (${date})`);
  lines.push("");

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    const num = offer.flightNumber ? ` ${offer.flightNumber}` : "";
    const stopsLabel = offer.stops === 0 ? "Nonstop" : `${offer.stops} stop${offer.stops > 1 ? "s" : ""}`;

    lines.push(`${i + 1}. ${offer.airline}${num}`);
    lines.push(`   Departure: ${offer.departureTime} → Arrival: ${offer.arrivalTime}`);
    lines.push(`   Duration: ${offer.duration} | ${stopsLabel}`);
    lines.push(`   Price: $${offer.price.toFixed(0)} ${offer.currency}`);
    if (offer.bookingUrl) {
      lines.push(`   Book: ${offer.bookingUrl}`);
    }
    if (i < offers.length - 1) lines.push("");
  }

  return lines.join("\n");
}

/**
 * Create the flight_search tool backed by one or more flight providers.
 * Providers are tried in order; on failure the next provider is attempted.
 */
export function createFlightTools(
  providers: FlightProvider[],
): BuiltinTool[] {
  return [
    {
      name: "flight_search",
      description:
        "Search for flights between airports. " +
        "Returns flight options with airlines, times, duration, stops, and prices.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "Departure airport IATA code (e.g. SFO, LAX, JFK)",
          },
          destination: {
            type: "string",
            description: "Arrival airport IATA code (e.g. NRT, LHR, CDG)",
          },
          date: {
            type: "string",
            description: "Departure date in ISO format (YYYY-MM-DD)",
          },
          return_date: {
            type: "string",
            description: "Return date in ISO format (YYYY-MM-DD) for round trips. Omit for one-way.",
          },
          adults: {
            type: "number",
            description: "Number of adult passengers (default: 1)",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return (default: 5, max: 10)",
          },
        },
        required: ["origin", "destination", "date"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const rawOrigin = args.origin as string;
        const rawDestination = args.destination as string;
        const rawDate = args.date as string;
        if (!rawOrigin) throw new Error("origin is required");
        if (!rawDestination) throw new Error("destination is required");
        if (!rawDate) throw new Error("date is required");

        const origin = rawOrigin.trim().toUpperCase();
        const destination = rawDestination.trim().toUpperCase();
        const date = rawDate.trim();
        const returnDate = args.return_date ? (args.return_date as string).trim() : undefined;
        const adults = typeof args.adults === "number" ? args.adults : 1;
        const maxResults = Math.min(
          typeof args.max_results === "number" ? args.max_results : 5,
          MAX_FLIGHT_RESULTS,
        );

        let lastError: Error | undefined;
        for (const provider of providers) {
          try {
            const offers = await executeFlightProvider(
              provider,
              origin,
              destination,
              date,
              returnDate,
              adults,
              maxResults,
            );
            return formatFlightResults(offers, origin, destination, date);
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
          }
        }

        throw lastError ?? new Error("No flight providers configured");
      },
    },
  ];
}
