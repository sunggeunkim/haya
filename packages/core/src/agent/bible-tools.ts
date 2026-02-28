import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const BIBLE_API_URL = "https://bible-api.com";
const BOLLS_SEARCH_URL = "https://bolls.life/v2/find";

// ---------------------------------------------------------------------------
// Book name map — bolls.life returns book as a numeric ID
// ---------------------------------------------------------------------------

const BOLLS_BOOK_NAMES: Record<number, string> = {
  1: "Genesis",
  2: "Exodus",
  3: "Leviticus",
  4: "Numbers",
  5: "Deuteronomy",
  6: "Joshua",
  7: "Judges",
  8: "Ruth",
  9: "1 Samuel",
  10: "2 Samuel",
  11: "1 Kings",
  12: "2 Kings",
  13: "1 Chronicles",
  14: "2 Chronicles",
  15: "Ezra",
  16: "Nehemiah",
  17: "Esther",
  18: "Job",
  19: "Psalms",
  20: "Proverbs",
  21: "Ecclesiastes",
  22: "Song of Solomon",
  23: "Isaiah",
  24: "Jeremiah",
  25: "Lamentations",
  26: "Ezekiel",
  27: "Daniel",
  28: "Hosea",
  29: "Joel",
  30: "Amos",
  31: "Obadiah",
  32: "Jonah",
  33: "Micah",
  34: "Nahum",
  35: "Habakkuk",
  36: "Zephaniah",
  37: "Haggai",
  38: "Zechariah",
  39: "Malachi",
  40: "Matthew",
  41: "Mark",
  42: "Luke",
  43: "John",
  44: "Acts",
  45: "Romans",
  46: "1 Corinthians",
  47: "2 Corinthians",
  48: "Galatians",
  49: "Ephesians",
  50: "Philippians",
  51: "Colossians",
  52: "1 Thessalonians",
  53: "2 Thessalonians",
  54: "1 Timothy",
  55: "2 Timothy",
  56: "Titus",
  57: "Philemon",
  58: "Hebrews",
  59: "James",
  60: "1 Peter",
  61: "2 Peter",
  62: "1 John",
  63: "2 John",
  64: "3 John",
  65: "Jude",
  66: "Revelation",
};

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface BibleApiVerse {
  book_id: string;
  book_name: string;
  chapter: number;
  verse: number;
  text: string;
}

interface BibleApiResponse {
  reference: string;
  verses: BibleApiVerse[];
  text: string;
  translation_id: string;
  translation_name: string;
}

interface BollsSearchResult {
  pk: number;
  translation: string;
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

interface BollsSearchResponse {
  results: BollsSearchResult[];
  exact_matches: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates Bible lookup and search tools (bible-api.com + bolls.life, no API key needed). */
export function createBibleTools(): BuiltinTool[] {
  return [
    // ----- bible_lookup -----
    {
      name: "bible_lookup",
      description:
        "Look up Bible verses by reference using the free bible-api.com API. " +
        "Supports abbreviated book names, verse ranges, and multiple translations (e.g. \"John 3:16\", \"Genesis 1:1-3\", \"Psalm 23\").",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          reference: {
            type: "string",
            description:
              "Bible reference to look up (e.g. \"John 3:16\", \"Genesis 1:1-3\", \"Psalm 23\")",
          },
          translation: {
            type: "string",
            description:
              "Translation ID (default: \"web\" for World English Bible). Examples: \"kjv\", \"web\", \"bbe\"",
          },
        },
        required: ["reference"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const reference = args.reference as string | undefined;
        if (!reference) {
          throw new Error("The 'reference' parameter is required.");
        }

        const translation = (args.translation as string) ?? "web";
        const url = `${BIBLE_API_URL}/${encodeURIComponent(reference)}?translation=${encodeURIComponent(translation)}`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Bible API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as BibleApiResponse;

        if (!data.verses || data.verses.length === 0) {
          throw new Error(`No verses found for reference: ${reference}`);
        }

        const lines: string[] = [
          `${data.reference} (${data.translation_name})`,
          "",
        ];

        for (const verse of data.verses) {
          lines.push(`${verse.verse} ${verse.text.trim()}`);
        }

        return lines.join("\n");
      },
    },

    // ----- bible_search -----
    {
      name: "bible_search",
      description:
        "Search the Bible for keywords using the free bolls.life API. " +
        "Returns matching verses with highlighted text. Supports multiple translations.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword or phrase to search for in the Bible text",
          },
          translation: {
            type: "string",
            description:
              "Translation ID (default: \"YLT\" for Young's Literal Translation). Examples: \"YLT\", \"KJV\", \"WEB\"",
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

        const translation = (args.translation as string) ?? "YLT";
        const rawMax = (args.max_results as number) ?? 10;
        const maxResults = Math.min(Math.max(1, rawMax), 20);

        const url = `${BOLLS_SEARCH_URL}/${encodeURIComponent(translation)}?search=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Bible search API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as BollsSearchResponse;

        if (!data.results || data.results.length === 0) {
          return `No results found for "${query}" in ${translation}.`;
        }

        const translationLabel =
          translation === "YLT"
            ? "Young's Literal Translation"
            : translation;

        const lines: string[] = [
          `Bible Search: "${query}" (${translationLabel})`,
          `Found ${data.total} matches, showing ${Math.min(maxResults, data.results.length)}:`,
          "",
        ];

        const results = data.results.slice(0, maxResults);
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const bookName = BOLLS_BOOK_NAMES[r.book] ?? `Book ${r.book}`;
          const cleanText = r.text.replace(/<\/?mark>/g, "");
          lines.push(`${i + 1}. ${bookName} ${r.chapter}:${r.verse}`);
          lines.push(`   ${cleanText.trim()}`);
          lines.push("");
        }

        return lines.join("\n").trimEnd();
      },
    },
  ];
}
