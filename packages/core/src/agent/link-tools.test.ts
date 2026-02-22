import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkTools } from "./link-tools.js";
import type { AgentTool } from "./types.js";

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createLinkTools", () => {
  it("returns exactly 1 tool", () => {
    const tools = createLinkTools();
    expect(tools).toHaveLength(1);
  });

  it("returns a tool named link_preview", () => {
    const tools = createLinkTools();
    expect(tools[0].name).toBe("link_preview");
  });

  it("link_preview has a url parameter", () => {
    const tools = createLinkTools();
    const tool = getTool(tools, "link_preview");
    const props = tool.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("url");
    expect(tool.parameters.required).toEqual(["url"]);
  });
});

// ---------------------------------------------------------------------------
// link_preview
// ---------------------------------------------------------------------------

describe("link_preview", () => {
  let tool: AgentTool;

  beforeEach(() => {
    tool = getTool(createLinkTools(), "link_preview");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // OG metadata extraction
  // -------------------------------------------------------------------------

  it("extracts Open Graph metadata from HTML", async () => {
    const html = `
      <html>
      <head>
        <title>Fallback Title</title>
        <meta property="og:title" content="OG Title" />
        <meta property="og:description" content="OG Description" />
        <meta property="og:image" content="https://example.com/image.png" />
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="Example Site" />
      </head>
      <body></body>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(html)),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com" }));

    expect(result.title).toBe("OG Title");
    expect(result.description).toBe("OG Description");
    expect(result.image).toBe("https://example.com/image.png");
    expect(result.type).toBe("article");
    expect(result.siteName).toBe("Example Site");
    expect(result.url).toBe("https://example.com");
  });

  // -------------------------------------------------------------------------
  // Fallback to <title> and <meta name="description">
  // -------------------------------------------------------------------------

  it("falls back to <title> and <meta name='description'> when no OG tags", async () => {
    const html = `
      <html>
      <head>
        <title>Page Title</title>
        <meta name="description" content="Page description text" />
      </head>
      <body></body>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(html)),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com/page" }));

    expect(result.title).toBe("Page Title");
    expect(result.description).toBe("Page description text");
    expect(result.image).toBeNull();
    expect(result.type).toBeNull();
    expect(result.siteName).toBeNull();
  });

  // -------------------------------------------------------------------------
  // OG tags take priority over fallbacks
  // -------------------------------------------------------------------------

  it("prefers OG tags over fallback title/description", async () => {
    const html = `
      <html>
      <head>
        <title>Fallback Title</title>
        <meta name="description" content="Fallback description" />
        <meta property="og:title" content="OG Title" />
        <meta property="og:description" content="OG Description" />
      </head>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(html)),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com" }));

    expect(result.title).toBe("OG Title");
    expect(result.description).toBe("OG Description");
  });

  // -------------------------------------------------------------------------
  // Fetch errors
  // -------------------------------------------------------------------------

  it("handles fetch network errors gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("Network error")),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com" }));

    expect(result.error).toBe("Network error");
    expect(result.url).toBe("https://example.com");
  });

  it("handles HTTP error responses gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      ),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com/missing" }));

    expect(result.error).toBe("HTTP 404: Not Found");
    expect(result.url).toBe("https://example.com/missing");
  });

  // -------------------------------------------------------------------------
  // Empty / malformed HTML
  // -------------------------------------------------------------------------

  it("handles empty HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("")),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com" }));

    expect(result.url).toBe("https://example.com");
    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
    expect(result.image).toBeNull();
    expect(result.type).toBeNull();
    expect(result.siteName).toBeNull();
  });

  it("handles HTML with no head section", async () => {
    const html = "<html><body><p>Hello world</p></body></html>";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(html)),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com" }));

    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
  });

  // -------------------------------------------------------------------------
  // URL validation
  // -------------------------------------------------------------------------

  it("rejects missing url parameter", async () => {
    const result = JSON.parse(await tool.execute({}));
    expect(result.error).toBe("url parameter is required");
  });

  it("rejects empty url parameter", async () => {
    const result = JSON.parse(await tool.execute({ url: "" }));
    expect(result.error).toBe("url parameter is required");
  });

  it("rejects non-HTTP URLs", async () => {
    const result = JSON.parse(await tool.execute({ url: "ftp://files.example.com" }));
    expect(result.error).toContain("Invalid URL");
  });

  it("rejects completely invalid URLs", async () => {
    const result = JSON.parse(await tool.execute({ url: "not-a-url" }));
    expect(result.error).toContain("Invalid URL");
  });

  // -------------------------------------------------------------------------
  // Description truncation
  // -------------------------------------------------------------------------

  it("truncates long descriptions to 500 characters", async () => {
    const longDescription = "A".repeat(600);
    const html = `
      <html>
      <head>
        <meta property="og:description" content="${longDescription}" />
      </head>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(html)),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com" }));

    expect(result.description.length).toBeLessThanOrEqual(503); // 500 + "..."
    expect(result.description.endsWith("...")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // HTML entity decoding
  // -------------------------------------------------------------------------

  it("decodes HTML entities in extracted text", async () => {
    const html = `
      <html>
      <head>
        <title>Tom &amp; Jerry&#39;s &quot;Adventure&quot;</title>
      </head>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(html)),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com" }));

    expect(result.title).toBe("Tom & Jerry's \"Adventure\"");
  });

  // -------------------------------------------------------------------------
  // Meta tag attribute ordering
  // -------------------------------------------------------------------------

  it("handles content attribute before property attribute", async () => {
    const html = `
      <html>
      <head>
        <meta content="Reversed Order Title" property="og:title" />
      </head>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(html)),
    );

    const result = JSON.parse(await tool.execute({ url: "https://example.com" }));

    expect(result.title).toBe("Reversed Order Title");
  });

  // -------------------------------------------------------------------------
  // User-Agent header
  // -------------------------------------------------------------------------

  it("sends the correct User-Agent header", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("<html><head><title>Test</title></head></html>"),
    );
    vi.stubGlobal("fetch", mockFetch);

    await tool.execute({ url: "https://example.com" });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Haya/0.1.0 (link-preview)");
  });
});
