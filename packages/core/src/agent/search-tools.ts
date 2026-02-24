import { requireSecret } from "../config/secrets.js";
import type { BuiltinTool } from "./builtin-tools.js";

const MAX_RESPONSE_LENGTH = 16_000;
const REQUEST_TIMEOUT_MS = 10_000;
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1";
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
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

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilySearchResponse {
  results?: TavilyResult[];
}

/** A single web search provider entry. */
export interface WebSearchProvider {
  provider: "brave" | "google" | "tavily";
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

/** Execute a search against the Tavily Search API. */
async function executeTavilySearch(
  query: string,
  count: number,
  apiKeyEnvVar: string,
): Promise<SearchResult[]> {
  const apiKey = requireSecret(apiKeyEnvVar);

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: count,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Tavily Search API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as TavilySearchResponse;
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
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
 * Execute a search against a single provider entry.
 */
async function executeProvider(
  provider: WebSearchProvider,
  query: string,
  count: number,
): Promise<SearchResult[]> {
  if (provider.provider === "google") {
    if (!provider.searchEngineId) {
      throw new Error(
        "searchEngineId is required for the Google CSE provider",
      );
    }
    return executeGoogleSearch(
      query,
      count,
      provider.apiKeyEnvVar,
      provider.searchEngineId,
    );
  }
  if (provider.provider === "tavily") {
    return executeTavilySearch(query, count, provider.apiKeyEnvVar);
  }
  return executeBraveSearch(query, count, provider.apiKeyEnvVar);
}

/**
 * Create the web search tool backed by one or more search providers.
 * Providers are tried in order; on failure the next provider is attempted.
 */
// --- Twitter/X Search ---

const TWITTER_SEARCH_URL = "https://api.twitter.com/2/tweets/search/recent";
const MAX_TWEET_RESULTS = 100;

interface TwitterPublicMetrics {
  retweet_count: number;
  reply_count: number;
  like_count: number;
}

interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  public_metrics?: TwitterPublicMetrics;
}

interface TwitterUser {
  id: string;
  name: string;
  username: string;
}

interface TwitterSearchResponse {
  data?: TwitterTweet[];
  includes?: {
    users?: TwitterUser[];
  };
}

interface TweetResult {
  author: string;
  username: string;
  text: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  url: string;
}

/** Execute a search against the Twitter/X API v2 recent search endpoint. */
async function executeTwitterSearch(
  query: string,
  count: number,
  apiKeyEnvVar: string,
): Promise<TweetResult[]> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(TWITTER_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(Math.max(count, 10)));
  url.searchParams.set("tweet.fields", "created_at,author_id,public_metrics");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Twitter API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as TwitterSearchResponse;
  if (!data.data || data.data.length === 0) {
    return [];
  }

  const usersById = new Map<string, TwitterUser>();
  if (data.includes?.users) {
    for (const user of data.includes.users) {
      usersById.set(user.id, user);
    }
  }

  return data.data.map((tweet) => {
    const user = usersById.get(tweet.author_id);
    const username = user?.username ?? "unknown";
    return {
      author: user?.name ?? "Unknown",
      username,
      text: tweet.text,
      createdAt: tweet.created_at ?? "",
      likes: tweet.public_metrics?.like_count ?? 0,
      retweets: tweet.public_metrics?.retweet_count ?? 0,
      replies: tweet.public_metrics?.reply_count ?? 0,
      url: `https://x.com/${username}/status/${tweet.id}`,
    };
  });
}

/** Format an array of tweet results into a numbered text list. */
function formatTweetResults(query: string, results: TweetResult[]): string {
  if (results.length === 0) {
    return `No tweets found for "${query}".`;
  }

  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const date = r.createdAt ? r.createdAt.slice(0, 10) : "unknown date";
    lines.push(`${i + 1}. @${r.username} (${r.author}) \u00b7 ${date}`);
    lines.push(`   ${r.text}`);
    lines.push(`   Likes: ${r.likes} | Retweets: ${r.retweets} | Replies: ${r.replies}`);
    lines.push(`   ${r.url}`);
    lines.push("");
  }

  const output = lines.join("\n").trimEnd();
  if (output.length > MAX_RESPONSE_LENGTH) {
    return `${output.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${output.length} chars total]`;
  }
  return output;
}

/** Configuration for the Twitter search tool. */
export interface TwitterSearchConfig {
  apiKeyEnvVar: string;
}

/** Create the twitter_search tool backed by the Twitter/X API v2. */
export function createTwitterSearchTools(config: TwitterSearchConfig): BuiltinTool[] {
  return [
    {
      name: "twitter_search",
      description:
        "Search Twitter/X for recent tweets (last 7 days). " +
        "Use this to find what people are saying about a topic, monitor events, or track discussions. " +
        "Supports Twitter search operators: from: (by user), is:retweet, -is:retweet (exclude retweets), " +
        "lang: (language), has:geo, place: (location), place_country: (country code).",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The Twitter search query (supports search operators)",
          },
          count: {
            type: "number",
            description: "Number of tweets to return (default: 10, min: 10, max: 100)",
          },
        },
        required: ["query"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string;
        if (!query) throw new Error("query is required");

        const count = Math.min(
          Math.max((args.count as number) ?? 10, 10),
          MAX_TWEET_RESULTS,
        );

        const results = await executeTwitterSearch(query, count, config.apiKeyEnvVar);
        return formatTweetResults(query, results);
      },
    },
  ];
}

export function createSearchTools(providers: WebSearchProvider[]): BuiltinTool[] {
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

        let lastError: Error | undefined;
        for (const provider of providers) {
          try {
            const results = await executeProvider(provider, query, count);
            return formatResults(query, results);
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
          }
        }

        throw lastError ?? new Error("No web search providers configured");
      },
    },
  ];
}
