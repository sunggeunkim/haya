import { requireSecret } from "../config/secrets.js";
import type { BuiltinTool } from "./builtin-tools.js";

const MAX_RESPONSE_LENGTH = 16_000;
const REQUEST_TIMEOUT_MS = 10_000;
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1";
const MAX_RESULTS = 20;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
  };
}

interface GoogleCseItem {
  title: string;
  link: string;
  snippet: string;
}

interface GoogleCseResponse {
  items?: GoogleCseItem[];
}

interface WebSearchConfig {
  provider: "brave" | "google";
  apiKeyEnvVar: string;
  searchEngineId?: string;
}

/** Execute a search against the Brave Search API. */
async function executeBraveSearch(
  query: string,
  count: number,
  apiKeyEnvVar: string,
): Promise<SearchResult[]> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Brave Search API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as BraveSearchResponse;
  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

/** Execute a search against the Google Custom Search JSON API. */
async function executeGoogleSearch(
  query: string,
  count: number,
  apiKeyEnvVar: string,
  searchEngineId: string,
): Promise<SearchResult[]> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(GOOGLE_CSE_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", searchEngineId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(count, 10)));

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Google CSE API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as GoogleCseResponse;
  return (data.items ?? []).map((item) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet,
  }));
}

/** Format an array of search results into a numbered text list. */
function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    lines.push("");
  }

  const output = lines.join("\n").trimEnd();
  if (output.length > MAX_RESPONSE_LENGTH) {
    return `${output.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${output.length} chars total]`;
  }
  return output;
}

/**
 * Create the web search tool backed by the configured search provider.
 */
export function createSearchTools(config: WebSearchConfig): BuiltinTool[] {
  return [
    {
      name: "web_search",
      description:
        "Search the web for current information. " +
        "Use this to answer questions about recent events, look up facts, or find information " +
        "that may not be in your training data.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
          count: {
            type: "number",
            description: "Number of results to return (default: 5, max: 20)",
          },
        },
        required: ["query"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string;
        if (!query) throw new Error("query is required");

        const count = Math.min(
          Math.max((args.count as number) ?? 5, 1),
          MAX_RESULTS,
        );

        let results: SearchResult[];
        if (config.provider === "google") {
          if (!config.searchEngineId) {
            throw new Error(
              "searchEngineId is required for the Google CSE provider",
            );
          }
          results = await executeGoogleSearch(
            query,
            count,
            config.apiKeyEnvVar,
            config.searchEngineId,
          );
        } else {
          results = await executeBraveSearch(
            query,
            count,
            config.apiKeyEnvVar,
          );
        }

        return formatResults(query, results);
      },
    },
  ];
}
