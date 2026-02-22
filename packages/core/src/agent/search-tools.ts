import { requireSecret } from "../config/secrets.js";
import type { BuiltinTool } from "./builtin-tools.js";

const MAX_RESPONSE_LENGTH = 16_000;
const REQUEST_TIMEOUT_MS = 10_000;
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 20;

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
  };
  query?: {
    original: string;
  };
}

/**
 * Create the web search tool backed by the Brave Search API.
 */
export function createSearchTools(apiKeyEnvVar: string): BuiltinTool[] {
  return [
    {
      name: "web_search",
      description:
        "Search the web for current information using Brave Search. " +
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
        const results = data.web?.results ?? [];

        if (results.length === 0) {
          return `No results found for "${query}".`;
        }

        const lines: string[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          lines.push(`${i + 1}. ${r.title}`);
          lines.push(`   ${r.url}`);
          if (r.description) {
            lines.push(`   ${r.description}`);
          }
          lines.push("");
        }

        const output = lines.join("\n").trimEnd();
        if (output.length > MAX_RESPONSE_LENGTH) {
          return `${output.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${output.length} chars total]`;
        }
        return output;
      },
    },
  ];
}
