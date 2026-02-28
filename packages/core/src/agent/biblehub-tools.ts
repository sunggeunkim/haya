import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const BIBLEHUB_BASE_URL = "https://biblehub.com";
const MAX_RESPONSE_LENGTH = 16_000;

// ---------------------------------------------------------------------------
// Book name normalization
// ---------------------------------------------------------------------------

const BOOK_URL_MAP: Record<string, string> = {
  genesis: "genesis", exodus: "exodus", leviticus: "leviticus",
  numbers: "numbers", deuteronomy: "deuteronomy", joshua: "joshua",
  judges: "judges", ruth: "ruth",
  "1 samuel": "1_samuel", "2 samuel": "2_samuel",
  "1 kings": "1_kings", "2 kings": "2_kings",
  "1 chronicles": "1_chronicles", "2 chronicles": "2_chronicles",
  ezra: "ezra", nehemiah: "nehemiah", esther: "esther",
  job: "job", psalms: "psalms", psalm: "psalms",
  proverbs: "proverbs", ecclesiastes: "ecclesiastes",
  "song of solomon": "songs", isaiah: "isaiah", jeremiah: "jeremiah",
  lamentations: "lamentations", ezekiel: "ezekiel", daniel: "daniel",
  hosea: "hosea", joel: "joel", amos: "amos", obadiah: "obadiah",
  jonah: "jonah", micah: "micah", nahum: "nahum", habakkuk: "habakkuk",
  zephaniah: "zephaniah", haggai: "haggai", zechariah: "zechariah",
  malachi: "malachi",
  matthew: "matthew", mark: "mark", luke: "luke", john: "john",
  acts: "acts", romans: "romans",
  "1 corinthians": "1_corinthians", "2 corinthians": "2_corinthians",
  galatians: "galatians", ephesians: "ephesians",
  philippians: "philippians", colossians: "colossians",
  "1 thessalonians": "1_thessalonians", "2 thessalonians": "2_thessalonians",
  "1 timothy": "1_timothy", "2 timothy": "2_timothy",
  titus: "titus", philemon: "philemon", hebrews: "hebrews",
  james: "james", "1 peter": "1_peter", "2 peter": "2_peter",
  "1 john": "1_john", "2 john": "2_john", "3 john": "3_john",
  jude: "jude", revelation: "revelation",
};

function normalizeBook(book: string): string {
  const lower = book.toLowerCase().trim();
  return BOOK_URL_MAP[lower] ?? lower.replace(/\s+/g, "_");
}

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|tr|td|th|blockquote)[^>]*>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string): string {
  if (text.length > MAX_RESPONSE_LENGTH) {
    return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates BibleHub tools for commentaries and interlinear data (scrapes biblehub.com). */
export function createBibleHubTools(): BuiltinTool[] {
  return [
    // ----- biblehub_commentary -----
    {
      name: "biblehub_commentary",
      description:
        "Get Bible commentaries for a specific verse from BibleHub.com. " +
        "Returns commentary excerpts from multiple scholars (Matthew Henry, Gill, Barnes, etc.). " +
        "Provide a book name, chapter, and verse.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          book: {
            type: "string",
            description:
              'Book name (e.g. "Genesis", "John", "Psalms", "1 Corinthians")',
          },
          chapter: {
            type: "number",
            description: "Chapter number",
          },
          verse: {
            type: "number",
            description: "Verse number",
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

        const urlBook = normalizeBook(book);
        const url = `${BIBLEHUB_BASE_URL}/commentaries/${urlBook}/${chapter}-${verse}.htm`;

        const response = await fetch(url, {
          headers: { "User-Agent": "Haya/0.1" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `BibleHub HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const html = await response.text();

        // Extract commentary sections
        const commentaryMatch = html.match(
          /<div class="cmt">([\s\S]*?)<\/div>\s*(?=<div class="cmt">|<div id=")/,
        );

        const bodyMatch = html.match(
          /<div class="padleft">([\s\S]*?)<\/div>\s*<div class="(?:footer|pad)/,
        );

        const content = commentaryMatch?.[1] ?? bodyMatch?.[1] ?? "";

        if (!content) {
          return `No commentary found for ${book} ${chapter}:${verse}. The page may not exist on BibleHub.`;
        }

        const text = stripHtml(content);
        const lines = [
          `Commentary: ${book} ${chapter}:${verse} (BibleHub)`,
          `Source: ${url}`,
          "",
          text,
        ];

        return truncate(lines.join("\n"));
      },
    },

    // ----- biblehub_interlinear -----
    {
      name: "biblehub_interlinear",
      description:
        "Get interlinear Bible data for a verse from BibleHub.com. " +
        "Shows the original Hebrew (OT) or Greek (NT) text with Strong's numbers, " +
        "transliterations, and word-by-word translations.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          book: {
            type: "string",
            description:
              'Book name (e.g. "Genesis", "John", "Psalms")',
          },
          chapter: {
            type: "number",
            description: "Chapter number",
          },
          verse: {
            type: "number",
            description: "Verse number",
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

        const urlBook = normalizeBook(book);
        const url = `${BIBLEHUB_BASE_URL}/interlinear/${urlBook}/${chapter}-${verse}.htm`;

        const response = await fetch(url, {
          headers: { "User-Agent": "Haya/0.1" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `BibleHub HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const html = await response.text();

        // Extract interlinear table content
        const tableMatch = html.match(
          /<div class="padleft">([\s\S]*?)<\/div>\s*<div class="(?:footer|pad)/,
        );

        const content = tableMatch?.[1] ?? "";

        if (!content) {
          return `No interlinear data found for ${book} ${chapter}:${verse}. The page may not exist on BibleHub.`;
        }

        const text = stripHtml(content);
        const lines = [
          `Interlinear: ${book} ${chapter}:${verse} (BibleHub)`,
          `Source: ${url}`,
          "",
          text,
        ];

        return truncate(lines.join("\n"));
      },
    },
  ];
}
