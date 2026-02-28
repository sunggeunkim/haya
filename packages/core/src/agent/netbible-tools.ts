import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const NET_BIBLE_API_URL = "https://labs.bible.org/api";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface NetBibleVerse {
  bookname: string;
  chapter: string;
  verse: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates NET Bible tools (labs.bible.org, no API key needed). */
export function createNetBibleTools(): BuiltinTool[] {
  return [
    // ----- netbible_lookup -----
    {
      name: "netbible_lookup",
      description:
        "Look up Bible verses in the NET Bible (New English Translation) using labs.bible.org. " +
        "Supports passage references like \"John 3:16\", \"Romans 8:28-30\", or \"Psalm 23\". " +
        "The NET Bible includes extensive translator notes and study notes.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          passage: {
            type: "string",
            description:
              'Bible passage to look up (e.g. "John 3:16", "Romans 8:28-30", "Psalm 23")',
          },
        },
        required: ["passage"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const passage = args.passage as string | undefined;
        if (!passage) {
          throw new Error("The 'passage' parameter is required.");
        }

        const url = `${NET_BIBLE_API_URL}/?passage=${encodeURIComponent(passage)}&type=json`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `NET Bible API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as NetBibleVerse[];

        if (!Array.isArray(data) || data.length === 0) {
          throw new Error(`No verses found for passage: ${passage}`);
        }

        const firstBook = data[0].bookname;
        const firstChapter = data[0].chapter;
        const lastVerse = data[data.length - 1].verse;
        const reference =
          data.length === 1
            ? `${firstBook} ${firstChapter}:${data[0].verse}`
            : `${firstBook} ${firstChapter}:${data[0].verse}-${lastVerse}`;

        const lines: string[] = [
          `${reference} (NET Bible)`,
          "",
        ];

        for (const verse of data) {
          const cleanText = verse.text
            .replace(/<\/?[^>]+(>|$)/g, "")
            .trim();
          lines.push(`${verse.verse} ${cleanText}`);
        }

        return lines.join("\n");
      },
    },

    // ----- netbible_random -----
    {
      name: "netbible_random",
      description:
        "Get a random Bible verse from the NET Bible (New English Translation). " +
        "Great for daily inspiration or devotional use.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const url = `${NET_BIBLE_API_URL}/?passage=random&type=json`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `NET Bible API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as NetBibleVerse[];

        if (!Array.isArray(data) || data.length === 0) {
          throw new Error("Failed to retrieve a random verse.");
        }

        const verse = data[0];
        const cleanText = verse.text
          .replace(/<\/?[^>]+(>|$)/g, "")
          .trim();

        return `${verse.bookname} ${verse.chapter}:${verse.verse} (NET Bible)\n\n${cleanText}`;
      },
    },
  ];
}
