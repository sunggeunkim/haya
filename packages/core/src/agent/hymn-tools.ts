import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const HYMNARY_API_URL = "https://hymnary.org/api/scripture";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface HymnEntry {
  title?: string;
  date?: string;
  meter?: string;
  "place of origin"?: string;
  "original language"?: string;
  "text link"?: string;
  "number of hymnals"?: number;
  "scripture references"?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates Hymnary.org scripture tools (hymnary.org, no API key needed). */
export function createHymnTools(): BuiltinTool[] {
  return [
    // ----- hymn_by_scripture -----
    {
      name: "hymn_by_scripture",
      description:
        "Find hymns related to a Bible passage using Hymnary.org. " +
        "Search by scripture reference (e.g. \"Psalm 23\", \"John 3:16\") to find hymns " +
        "that are based on or inspired by that passage. Returns up to 100 hymns with " +
        "titles, dates, meters, and the number of hymnals they appear in.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          reference: {
            type: "string",
            description:
              'Scripture reference (e.g. "Psalm 23", "John 3:16", "Romans 8")',
          },
          book: {
            type: "string",
            description:
              'Book name for range search (e.g. "1 John"). Use with fromChapter/fromVerse.',
          },
          fromChapter: {
            type: "number",
            description: "Starting chapter for range search",
          },
          fromVerse: {
            type: "number",
            description: "Starting verse for range search",
          },
          toChapter: {
            type: "number",
            description: "Ending chapter for range search",
          },
          toVerse: {
            type: "number",
            description: "Ending verse for range search",
          },
          include_all: {
            type: "boolean",
            description:
              "Include hymns with incomplete information (default: false)",
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of results to return (default: 15, max: 100)",
          },
        },
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const reference = args.reference as string | undefined;
        const book = args.book as string | undefined;
        const fromChapter = args.fromChapter as number | undefined;

        if (!reference && !book) {
          throw new Error(
            "Provide either 'reference' (e.g. \"Psalm 23\") or 'book' + 'fromChapter' parameters.",
          );
        }

        const params = new URLSearchParams();

        if (reference) {
          params.set("reference", reference);
        } else {
          if (book) params.set("book", book);
          if (fromChapter != null) params.set("fromChapter", String(fromChapter));
          if (args.fromVerse != null) params.set("fromVerse", String(args.fromVerse));
          if (args.toChapter != null) params.set("toChapter", String(args.toChapter));
          if (args.toVerse != null) params.set("toVerse", String(args.toVerse));
        }

        if (args.include_all) {
          params.set("all", "true");
        }

        const url = `${HYMNARY_API_URL}?${params.toString()}`;

        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Hymnary API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as HymnEntry[];

        if (!Array.isArray(data) || data.length === 0) {
          const passageDesc = reference ?? `${book} ${fromChapter}`;
          return `No hymns found for "${passageDesc}".`;
        }

        const rawMax = (args.max_results as number) ?? 15;
        const maxResults = Math.min(Math.max(1, rawMax), 100);
        const hymns = data.slice(0, maxResults);

        const passageDesc = reference ?? `${book} ${fromChapter}`;
        const lines: string[] = [
          `Hymns for ${passageDesc} (${Math.min(maxResults, data.length)} of ${data.length}):`,
          "",
        ];

        for (let i = 0; i < hymns.length; i++) {
          const h = hymns[i];
          const title = h.title ?? "(untitled)";
          lines.push(`${i + 1}. ${title}`);

          if (h.date) lines.push(`   Date: ${h.date}`);
          if (h.meter) lines.push(`   Meter: ${h.meter}`);
          if (h["original language"]) lines.push(`   Language: ${h["original language"]}`);
          if (h["number of hymnals"]) lines.push(`   Hymnals: ${h["number of hymnals"]}`);
          if (h["scripture references"]) lines.push(`   Scripture: ${h["scripture references"]}`);
          if (h["text link"]) lines.push(`   Link: https://hymnary.org${h["text link"]}`);
          lines.push("");
        }

        return lines.join("\n").trimEnd();
      },
    },
  ];
}
