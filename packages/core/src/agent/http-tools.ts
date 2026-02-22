import type { BuiltinTool } from "./builtin-tools.js";

const MAX_BODY_LENGTH = 16_000;
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHttpTools(): BuiltinTool[] {
  return [
    {
      name: "http_request",
      description:
        "Make an HTTP request with full control over method, headers, body, and see the complete response " +
        "including status code and headers. More powerful than web_fetch for API testing.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to send the request to",
          },
          method: {
            type: "string",
            enum: [
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
            ],
            description: "HTTP method (default: GET)",
          },
          headers: {
            type: "object",
            description: "Key-value pairs of request headers",
          },
          body: {
            type: "string",
            description: "Request body (for POST, PUT, PATCH, etc.)",
          },
          timeout: {
            type: "number",
            description: "Request timeout in milliseconds (default: 30000)",
          },
        },
        required: ["url"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const url = args.url as string;
        if (!url) throw new Error("url is required");

        // Validate URL
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error(`Invalid URL: ${url}`);
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(
            `Unsupported protocol: ${parsed.protocol} — only http and https are allowed.`,
          );
        }

        const method = (args.method as string) ?? "GET";
        const headers = (args.headers as Record<string, string>) ?? {};
        const body = args.body as string | undefined;
        const timeout = (args.timeout as number) ?? DEFAULT_TIMEOUT_MS;

        const fetchOptions: RequestInit = {
          method,
          headers,
          signal: AbortSignal.timeout(timeout),
        };

        if (body !== undefined && method !== "GET" && method !== "HEAD") {
          fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);

        // Format response headers
        const responseHeaders: string[] = [];
        response.headers.forEach((value, key) => {
          responseHeaders.push(`  ${key}: ${value}`);
        });

        const lines: string[] = [
          `HTTP ${response.status} ${response.statusText}`,
          "",
          "Response headers:",
          ...responseHeaders,
        ];

        // For HEAD requests, skip the body
        if (method !== "HEAD") {
          const text = await response.text();
          lines.push("");
          lines.push("Body:");
          if (text.length > MAX_BODY_LENGTH) {
            lines.push(
              `${text.slice(0, MAX_BODY_LENGTH)}\n\n[Truncated — ${text.length} chars total]`,
            );
          } else {
            lines.push(text);
          }
        }

        return lines.join("\n");
      },
    },
  ];
}
