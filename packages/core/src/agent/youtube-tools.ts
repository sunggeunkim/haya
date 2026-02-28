import { requireSecret } from "../config/secrets.js";
import type { BuiltinTool } from "./builtin-tools.js";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_LENGTH = 16_000;

/** Configuration for YouTube Data API v3 integration. */
export interface YouTubeConfig {
  apiKeyEnvVar: string;
}

/** Shared helper to call the YouTube Data API v3. */
async function callYouTubeApi(
  endpoint: string,
  params: Record<string, string>,
  apiKeyEnvVar: string,
): Promise<unknown> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const searchParams = new URLSearchParams({ ...params, key: apiKey });
  const url = `${YOUTUBE_API_BASE}/${endpoint}?${searchParams.toString()}`;

  const response = await fetch(url, {
    headers: { "User-Agent": "Haya/0.1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`YouTube API HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

/** Truncate long responses to stay within tool output limits. */
function truncate(text: string): string {
  if (text.length > MAX_RESPONSE_LENGTH) {
    return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
  }
  return text;
}

/** Convert ISO 8601 duration (PT1H2M3S) to human-readable format. */
function formatDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;
  const hours = match[1] ? `${match[1]}h ` : "";
  const minutes = match[2] ? `${match[2]}m ` : "";
  const seconds = match[3] ? `${match[3]}s` : "";
  const result = `${hours}${minutes}${seconds}`.trim();
  return result || "0s";
}

/** Format a number with locale separators. */
function formatNumber(n: number | string): string {
  return Number(n).toLocaleString("en-US");
}

// --- Response interfaces ---

interface YouTubeSearchItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    description: string;
  };
}

interface YouTubeVideoItem {
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    description: string;
    tags?: string[];
  };
  contentDetails: {
    duration: string;
    definition: string;
    caption: string;
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface YouTubeCaptionItem {
  snippet: {
    language: string;
    name: string;
    trackKind: string;
  };
}

/**
 * Create YouTube Data API v3 tools.
 * Returns 3 tools: youtube_search, youtube_video_details, youtube_captions.
 */
export function createYouTubeTools(config: YouTubeConfig): BuiltinTool[] {
  const { apiKeyEnvVar } = config;

  return [
    // -----------------------------------------------------------------------
    // youtube_search — search videos by keyword
    // -----------------------------------------------------------------------
    {
      name: "youtube_search",
      description:
        "Search YouTube videos by keyword. Returns titles, channels, dates, URLs, and descriptions.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          maxResults: {
            type: "number",
            description: "Number of results to return (1-25, default 5)",
          },
          order: {
            type: "string",
            enum: ["relevance", "date", "viewCount", "rating"],
            description: "Sort order (default: relevance)",
          },
        },
        required: ["query"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string;
        if (!query) throw new Error("query is required");

        const maxResults = Math.min(Math.max(Number(args.maxResults) || 5, 1), 25);
        const order = (args.order as string) || "relevance";

        const data = (await callYouTubeApi("search", {
          part: "snippet",
          type: "video",
          q: query,
          maxResults: String(maxResults),
          order,
        }, apiKeyEnvVar)) as { items?: YouTubeSearchItem[] };

        const items = data.items ?? [];
        if (items.length === 0) return "No videos found.";

        const lines = items.map((item, i) => {
          const s = item.snippet;
          const videoId = item.id.videoId ?? "unknown";
          const date = s.publishedAt.split("T")[0];
          return [
            `${i + 1}. ${s.title}`,
            `   Channel: ${s.channelTitle}`,
            `   Date: ${date}`,
            `   URL: https://www.youtube.com/watch?v=${videoId}`,
            `   ${s.description}`,
          ].join("\n");
        });

        return truncate(lines.join("\n\n"));
      },
    },

    // -----------------------------------------------------------------------
    // youtube_video_details — get full metadata by video ID
    // -----------------------------------------------------------------------
    {
      name: "youtube_video_details",
      description:
        "Get full metadata for a YouTube video by its ID. Returns title, channel, date, " +
        "duration, view/like/comment counts, quality, captions availability, tags, and description.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          videoId: {
            type: "string",
            description: "YouTube video ID (e.g., dQw4w9WgXcQ)",
          },
        },
        required: ["videoId"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const videoId = args.videoId as string;
        if (!videoId) throw new Error("videoId is required");

        const data = (await callYouTubeApi("videos", {
          part: "snippet,contentDetails,statistics",
          id: videoId,
        }, apiKeyEnvVar)) as { items?: YouTubeVideoItem[] };

        const items = data.items ?? [];
        if (items.length === 0) return "Video not found.";

        const item = items[0];
        const s = item.snippet;
        const cd = item.contentDetails;
        const st = item.statistics;

        const lines: string[] = [
          `Title: ${s.title}`,
          `Channel: ${s.channelTitle}`,
          `Published: ${s.publishedAt.split("T")[0]}`,
          `Duration: ${formatDuration(cd.duration)}`,
          `Quality: ${cd.definition.toUpperCase()}`,
          `Captions: ${cd.caption === "true" ? "Yes" : "No"}`,
          `URL: https://www.youtube.com/watch?v=${videoId}`,
        ];

        if (st.viewCount) lines.push(`Views: ${formatNumber(st.viewCount)}`);
        if (st.likeCount) lines.push(`Likes: ${formatNumber(st.likeCount)}`);
        if (st.commentCount) lines.push(`Comments: ${formatNumber(st.commentCount)}`);
        if (s.tags && s.tags.length > 0) lines.push(`Tags: ${s.tags.join(", ")}`);
        if (s.description) lines.push(`\nDescription:\n${s.description}`);

        return truncate(lines.join("\n"));
      },
    },

    // -----------------------------------------------------------------------
    // youtube_captions — list caption tracks for a video
    // -----------------------------------------------------------------------
    {
      name: "youtube_captions",
      description:
        "List available caption tracks for a YouTube video. Returns language, name, and track kind " +
        "(standard or ASR auto-generated). Note: downloading caption content requires OAuth.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          videoId: {
            type: "string",
            description: "YouTube video ID",
          },
        },
        required: ["videoId"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const videoId = args.videoId as string;
        if (!videoId) throw new Error("videoId is required");

        const data = (await callYouTubeApi("captions", {
          part: "snippet",
          videoId,
        }, apiKeyEnvVar)) as { items?: YouTubeCaptionItem[] };

        const items = data.items ?? [];
        if (items.length === 0) return "No caption tracks found.";

        const lines = items.map((item) => {
          const s = item.snippet;
          const kind = s.trackKind === "ASR" ? " (auto-generated)" : "";
          const name = s.name ? ` — ${s.name}` : "";
          return `- ${s.language}${name}${kind}`;
        });

        return lines.join("\n");
      },
    },
  ];
}
