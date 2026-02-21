import type { AgentTool } from "./types.js";

/**
 * Built-in tools available to the agent runtime.
 */

/**
 * Fetches a URL and returns the response body as text.
 * Enables the agent to look up weather, documentation, APIs, etc.
 */
export const webFetchTool: AgentTool = {
  name: "web_fetch",
  description:
    "Fetch the contents of a URL and return the response as text. " +
    "Use this to look up current information such as weather, news, or documentation.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
    },
    required: ["url"],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const url = args.url as string;
    if (!url) {
      throw new Error("url is required");
    }

    // Basic URL validation
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Only allow http/https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "Haya/0.1" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();

    // Truncate very large responses to avoid blowing up context
    const MAX_LENGTH = 16_000;
    if (text.length > MAX_LENGTH) {
      return `${text.slice(0, MAX_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
    }

    return text;
  },
};

/** All built-in tools. */
export const builtinTools: AgentTool[] = [webFetchTool];
