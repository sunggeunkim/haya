import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const BIBLESDK_API_URL = "https://biblesdk.com/api";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface BibleSdkBook {
  code: string;
  name: string;
  chapters: number;
}

interface BibleSdkConcordanceEntry {
  strongs: string;
  original: string;
  transliteration: string;
  definition: string;
}

interface BibleSdkVerse {
  book: string;
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
  concordance?: BibleSdkConcordanceEntry[];
}

interface BibleSdkVersesResponse {
  verses: BibleSdkVerse[];
}

interface BibleSdkSearchResult {
  book: string;
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
  score?: number;
}

interface BibleSdkSearchResponse {
  results: BibleSdkSearchResult[];
  query: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates Bible SDK tools (biblesdk.com, no API key needed). */
export function createBibleSdkTools(): BuiltinTool[] {
  return [
    // ----- biblesdk_verse -----
    {
      name: "biblesdk_verse",
      description:
        "Look up Bible verses using the Bible SDK API (NET Bible). " +
        "Supports Strong's concordance data with original Hebrew/Greek words, " +
        "transliterations, and definitions. Use concordance=true for study purposes.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          book: {
            type: "string",
            description:
              'Book code (e.g. "GEN", "EXO", "PSA", "MAT", "JHN", "ROM", "REV")',
          },
          chapter: {
            type: "number",
            description: "Chapter number",
          },
          verse: {
            type: "number",
            description: "Starting verse number",
          },
          endVerse: {
            type: "number",
            description: "Ending verse number for a range (optional)",
          },
          concordance: {
            type: "boolean",
            description:
              "Include Strong's concordance data with original language info (default: false)",
          },
        },
        required: ["book", "chapter", "verse"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const book = args.book as string | undefined;
        const chapter = args.chapter as number | undefined;
        const verse = args.verse as number | undefined;

        if (!book) throw new Error("The 'book' parameter is required.");
        if (chapter == null) throw new Error("The 'chapter' parameter is required.");
        if (verse == null) throw new Error("The 'verse' parameter is required.");

        const endVerse = (args.endVerse as number) ?? verse;
        const concordance = (args.concordance as boolean) ?? false;

        let url = `${BIBLESDK_API_URL}/books/${encodeURIComponent(book.toUpperCase())}/chapters/${chapter}/verses/${verse}`;
        if (endVerse > verse) {
          url += `-${endVerse}`;
        }
        if (concordance) {
          url += "?concordance=true";
        }

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Bible SDK API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as BibleSdkVersesResponse;
        const verses = data.verses ?? [];

        if (verses.length === 0) {
          throw new Error(
            `No verses found for ${book} ${chapter}:${verse}`,
          );
        }

        const bookName = verses[0].bookName ?? book;
        const refEnd = endVerse > verse ? `-${endVerse}` : "";
        const lines: string[] = [
          `${bookName} ${chapter}:${verse}${refEnd} (NET Bible via Bible SDK)`,
          "",
        ];

        for (const v of verses) {
          lines.push(`${v.verse} ${v.text.trim()}`);

          if (concordance && v.concordance && v.concordance.length > 0) {
            lines.push("  Strong's Concordance:");
            for (const c of v.concordance) {
              lines.push(
                `    ${c.strongs} | ${c.original} (${c.transliteration}): ${c.definition}`,
              );
            }
          }
        }

        return lines.join("\n");
      },
    },

    // ----- biblesdk_search -----
    {
      name: "biblesdk_search",
      description:
        "Semantic search across the Bible using Bible SDK's AI-powered search. " +
        "Search by meaning rather than exact text match — e.g. \"love your neighbor\", " +
        "\"faith and works\", \"God's promises about fear\".",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural language search query (e.g. \"love your neighbor\", \"dealing with anxiety\")",
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of results to return (default: 10, max: 20)",
          },
        },
        required: ["query"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string | undefined;
        if (!query) {
          throw new Error("The 'query' parameter is required.");
        }

        const rawMax = (args.max_results as number) ?? 10;
        const maxResults = Math.min(Math.max(1, rawMax), 20);

        const url = `${BIBLESDK_API_URL}/search?query=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Bible SDK API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as BibleSdkSearchResponse;
        const results = data.results ?? [];

        if (results.length === 0) {
          return `No results found for "${query}".`;
        }

        const lines: string[] = [
          `Bible Search: "${query}"`,
          `Found ${results.length} results, showing ${Math.min(maxResults, results.length)}:`,
          "",
        ];

        const shown = results.slice(0, maxResults);
        for (let i = 0; i < shown.length; i++) {
          const r = shown[i];
          lines.push(`${i + 1}. ${r.bookName} ${r.chapter}:${r.verse}`);
          lines.push(`   ${r.text.trim()}`);
          lines.push("");
        }

        return lines.join("\n").trimEnd();
      },
    },
  ];
}
