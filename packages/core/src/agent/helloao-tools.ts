import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const HELLOAO_API_URL = "https://bible.helloao.org/api";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface HelloAoTranslation {
  id: string;
  name: string;
  shortName?: string;
  englishName: string;
  language: string;
  languageEnglishName: string;
  textDirection: string;
  numberOfBooks: number;
  totalNumberOfChapters: number;
  totalNumberOfVerses: number;
  listOfBooksApiLink: string;
}

interface HelloAoTranslationsResponse {
  translations: HelloAoTranslation[];
}

interface HelloAoBook {
  id: string;
  name: string;
  numberOfChapters: number;
}

interface HelloAoBooksResponse {
  books: HelloAoBook[];
  translation: { id: string; name: string };
}

interface HelloAoContentItem {
  type: string;
  number?: number;
  content?: (string | { noteId: number })[];
}

interface HelloAoChapterResponse {
  translation: { id: string; name: string };
  book: { id: string; name: string };
  chapter: { number: number; content: HelloAoContentItem[] };
  numberOfVerses: number;
  thisChapterLink: string;
  nextChapterApiLink?: string;
  previousChapterApiLink?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates HelloAO Bible API tools (bible.helloao.org, no API key needed). */
export function createHelloAoTools(): BuiltinTool[] {
  return [
    // ----- helloao_translations -----
    {
      name: "helloao_translations",
      description:
        "List available Bible translations from the HelloAO Free Bible API. " +
        "Over 1,000 translations in 200+ languages. Filter by language or search by name.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          language: {
            type: "string",
            description:
              'Filter by language (e.g. "English", "Spanish", "Korean", "Arabic")',
          },
          search: {
            type: "string",
            description:
              "Search translations by name (case-insensitive)",
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of results to return (default: 20, max: 50)",
          },
        },
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const url = `${HELLOAO_API_URL}/available_translations.json`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `HelloAO API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as HelloAoTranslationsResponse;
        let translations = data.translations ?? [];

        const language = args.language as string | undefined;
        if (language) {
          const lower = language.toLowerCase();
          translations = translations.filter(
            (t) =>
              t.languageEnglishName.toLowerCase().includes(lower) ||
              t.language.toLowerCase().includes(lower),
          );
        }

        const search = args.search as string | undefined;
        if (search) {
          const lower = search.toLowerCase();
          translations = translations.filter(
            (t) =>
              t.englishName.toLowerCase().includes(lower) ||
              t.id.toLowerCase().includes(lower) ||
              (t.shortName ?? "").toLowerCase().includes(lower),
          );
        }

        if (translations.length === 0) {
          const filter = language ?? search ?? "";
          return `No translations found matching "${filter}".`;
        }

        const rawMax = (args.max_results as number) ?? 20;
        const maxResults = Math.min(Math.max(1, rawMax), 50);
        const shown = translations.slice(0, maxResults);

        const lines: string[] = [
          `Bible Translations (${shown.length} of ${translations.length}):`,
          "",
        ];

        for (const t of shown) {
          lines.push(
            `- ${t.id}: ${t.englishName} (${t.languageEnglishName}, ${t.numberOfBooks} books, ${t.totalNumberOfVerses} verses)`,
          );
        }

        if (translations.length > maxResults) {
          lines.push(
            "",
            `... and ${translations.length - maxResults} more. Use 'language' or 'search' to filter.`,
          );
        }

        return lines.join("\n");
      },
    },

    // ----- helloao_chapter -----
    {
      name: "helloao_chapter",
      description:
        "Read a Bible chapter from the HelloAO Free Bible API. " +
        "Supports 1,000+ translations. Provide translation ID, book code, and chapter number. " +
        "Use helloao_translations to find available translation IDs.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          translation: {
            type: "string",
            description:
              'Translation ID (e.g. "BSB" for Berean Standard Bible, "ENGWEBP" for World English Bible)',
          },
          book: {
            type: "string",
            description:
              'Book code (e.g. "GEN", "EXO", "PSA", "MAT", "JHN", "ROM", "REV")',
          },
          chapter: {
            type: "number",
            description: "Chapter number",
          },
          verse_start: {
            type: "number",
            description: "Starting verse to display (optional, shows full chapter by default)",
          },
          verse_end: {
            type: "number",
            description: "Ending verse to display (optional)",
          },
        },
        required: ["translation", "book", "chapter"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const translation = args.translation as string | undefined;
        const book = args.book as string | undefined;
        const chapter = args.chapter as number | undefined;

        if (!translation) throw new Error("The 'translation' parameter is required.");
        if (!book) throw new Error("The 'book' parameter is required.");
        if (chapter == null) throw new Error("The 'chapter' parameter is required.");

        const url = `${HELLOAO_API_URL}/${encodeURIComponent(translation)}/${encodeURIComponent(book.toUpperCase())}/${chapter}.json`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `HelloAO API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as HelloAoChapterResponse;
        const content = data.chapter?.content ?? [];

        const verseStart = (args.verse_start as number) ?? 1;
        const verseEnd = (args.verse_end as number) ?? data.numberOfVerses;

        const bookName = data.book?.name ?? book;
        const transName = data.translation?.name ?? translation;

        const rangeStr =
          verseStart === 1 && verseEnd >= data.numberOfVerses
            ? ""
            : `:${verseStart}${verseEnd > verseStart ? `-${verseEnd}` : ""}`;

        const lines: string[] = [
          `${bookName} ${chapter}${rangeStr} (${transName})`,
          "",
        ];

        for (const item of content) {
          if (item.type === "heading" && item.content) {
            const headingText = item.content
              .filter((c): c is string => typeof c === "string")
              .join(" ");
            if (headingText) {
              lines.push(`[${headingText}]`);
            }
          } else if (
            item.type === "verse" &&
            item.number != null &&
            item.number >= verseStart &&
            item.number <= verseEnd
          ) {
            const verseText = (item.content ?? [])
              .filter((c): c is string => typeof c === "string")
              .join("")
              .trim();
            if (verseText) {
              lines.push(`${item.number} ${verseText}`);
            }
          }
        }

        return lines.join("\n");
      },
    },
  ];
}
