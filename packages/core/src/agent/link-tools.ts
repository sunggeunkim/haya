import type { AgentTool } from "./types.js";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_DESCRIPTION_LENGTH = 500;
const USER_AGENT = "Haya/0.1.0 (link-preview)";

// ---------------------------------------------------------------------------
// HTML parsing helpers (regex-based, no external dependency)
// ---------------------------------------------------------------------------

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1].trim()) : undefined;
}

function extractMetaContent(
  html: string,
  attrName: string,
  attrValue: string,
): string | undefined {
  // Match both orders: name/property before content, and content before name/property
  const pattern1 = new RegExp(
    `<meta\\s+[^>]*${attrName}=["']${escapeRegex(attrValue)}["'][^>]*content=["']([^"']*)["'][^>]*/?>`,
    "i",
  );
  const pattern2 = new RegExp(
    `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attrName}=["']${escapeRegex(attrValue)}["'][^>]*/?>`,
    "i",
  );

  const match1 = pattern1.exec(html);
  if (match1) return decodeEntities(match1[1]);

  const match2 = pattern2.exec(html);
  if (match2) return decodeEntities(match2[1]);

  return undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function truncateDescription(text: string): string {
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text;
  return text.slice(0, MAX_DESCRIPTION_LENGTH).trimEnd() + "...";
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

interface LinkMetadata {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  type: string | null;
  siteName: string | null;
}

function extractMetadata(html: string, url: string): LinkMetadata {
  const ogTitle = extractMetaContent(html, "property", "og:title");
  const ogDescription = extractMetaContent(html, "property", "og:description");
  const ogImage = extractMetaContent(html, "property", "og:image");
  const ogType = extractMetaContent(html, "property", "og:type");
  const ogSiteName = extractMetaContent(html, "property", "og:site_name");

  const fallbackTitle = extractTitle(html);
  const fallbackDescription = extractMetaContent(html, "name", "description");

  const title = ogTitle ?? fallbackTitle ?? null;
  const rawDescription = ogDescription ?? fallbackDescription ?? null;
  const description = rawDescription
    ? truncateDescription(rawDescription)
    : null;

  return {
    url,
    title,
    description,
    image: ogImage ?? null,
    type: ogType ?? null,
    siteName: ogSiteName ?? null,
  };
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// link_preview tool
// ---------------------------------------------------------------------------

const linkPreviewTool: AgentTool = {
  name: "link_preview",
  description:
    "Fetch a URL and extract its metadata (title, description, image, type). " +
    "Useful for understanding what a link points to without reading the full page.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch and extract metadata from",
      },
    },
    required: ["url"],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const url = args.url as string;

    if (!url) {
      return JSON.stringify({ error: "url parameter is required" });
    }

    if (!isValidUrl(url)) {
      return JSON.stringify({ error: `Invalid URL: ${url}` });
    }

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "follow",
      });

      if (!response.ok) {
        return JSON.stringify({
          error: `HTTP ${response.status}: ${response.statusText}`,
          url,
        });
      }

      const html = await response.text();
      const metadata = extractMetadata(html, url);

      return JSON.stringify(metadata);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: message, url });
    }
  },
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createLinkTools(): AgentTool[] {
  return [linkPreviewTool];
}
