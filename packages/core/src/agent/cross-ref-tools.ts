import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 15_000;
const CROSS_REF_DATA_URL =
  "https://a.openbible.info/data/cross-references.txt.gz";

// ---------------------------------------------------------------------------
// In-memory cross-reference index (lazy-loaded)
// ---------------------------------------------------------------------------

let crossRefMap: Map<string, string[]> | null = null;

/**
 * Normalize an OSIS-style reference (e.g. "Gen.1.1") to a human-readable
 * format (e.g. "Genesis 1:1").
 */
const OSIS_BOOK_MAP: Record<string, string> = {
  Gen: "Genesis", Exod: "Exodus", Lev: "Leviticus", Num: "Numbers",
  Deut: "Deuteronomy", Josh: "Joshua", Judg: "Judges", Ruth: "Ruth",
  "1Sam": "1 Samuel", "2Sam": "2 Samuel", "1Kgs": "1 Kings", "2Kgs": "2 Kings",
  "1Chr": "1 Chronicles", "2Chr": "2 Chronicles", Ezra: "Ezra", Neh: "Nehemiah",
  Esth: "Esther", Job: "Job", Ps: "Psalms", Prov: "Proverbs",
  Eccl: "Ecclesiastes", Song: "Song of Solomon", Isa: "Isaiah", Jer: "Jeremiah",
  Lam: "Lamentations", Ezek: "Ezekiel", Dan: "Daniel", Hos: "Hosea",
  Joel: "Joel", Amos: "Amos", Obad: "Obadiah", Jonah: "Jonah",
  Mic: "Micah", Nah: "Nahum", Hab: "Habakkuk", Zeph: "Zephaniah",
  Hag: "Haggai", Zech: "Zechariah", Mal: "Malachi",
  Matt: "Matthew", Mark: "Mark", Luke: "Luke", John: "John",
  Acts: "Acts", Rom: "Romans", "1Cor": "1 Corinthians", "2Cor": "2 Corinthians",
  Gal: "Galatians", Eph: "Ephesians", Phil: "Philippians", Col: "Colossians",
  "1Thess": "1 Thessalonians", "2Thess": "2 Thessalonians",
  "1Tim": "1 Timothy", "2Tim": "2 Timothy", Titus: "Titus", Phlm: "Philemon",
  Heb: "Hebrews", Jas: "James", "1Pet": "1 Peter", "2Pet": "2 Peter",
  "1John": "1 John", "2John": "2 John", "3John": "3 John",
  Jude: "Jude", Rev: "Revelation",
};

/** Reverse map: human-readable name -> OSIS abbreviation */
const REVERSE_BOOK_MAP: Record<string, string> = {};
for (const [osis, human] of Object.entries(OSIS_BOOK_MAP)) {
  REVERSE_BOOK_MAP[human.toLowerCase()] = osis;
}
// Add common short forms
REVERSE_BOOK_MAP["psalm"] = "Ps";
REVERSE_BOOK_MAP["psalms"] = "Ps";
REVERSE_BOOK_MAP["genesis"] = "Gen";
REVERSE_BOOK_MAP["exodus"] = "Exod";
REVERSE_BOOK_MAP["leviticus"] = "Lev";
REVERSE_BOOK_MAP["numbers"] = "Num";
REVERSE_BOOK_MAP["deuteronomy"] = "Deut";
REVERSE_BOOK_MAP["matthew"] = "Matt";
REVERSE_BOOK_MAP["romans"] = "Rom";
REVERSE_BOOK_MAP["revelation"] = "Rev";

function osisToHuman(osis: string): string {
  // Format: "Book.Chapter.Verse" or "Book.Chapter.Verse-Book.Chapter.Verse"
  const parts = osis.split("-");
  const formatted = parts.map((part) => {
    const segs = part.split(".");
    if (segs.length < 3) return part;
    const bookName = OSIS_BOOK_MAP[segs[0]] ?? segs[0];
    return `${bookName} ${segs[1]}:${segs[2]}`;
  });
  return formatted.join("-");
}

function humanToOsis(reference: string): string {
  // Parse "Genesis 1:1" or "1 John 3:16" to "Gen.1.1" or "1John.3.16"
  const match = reference.match(
    /^(\d?\s*[A-Za-z]+(?:\s+of\s+\w+)?)\s+(\d+):(\d+)$/,
  );
  if (!match) return reference;

  const bookInput = match[1].trim().toLowerCase();
  const chapter = match[2];
  const verse = match[3];

  const osisBook = REVERSE_BOOK_MAP[bookInput];
  if (!osisBook) return reference;

  return `${osisBook}.${chapter}.${verse}`;
}

async function loadCrossReferences(): Promise<Map<string, string[]>> {
  if (crossRefMap) return crossRefMap;

  const response = await fetch(CROSS_REF_DATA_URL, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download cross-references: HTTP ${response.status}`,
    );
  }

  const { Readable } = await import("node:stream");
  const { createGunzip } = await import("node:zlib");
  const { createInterface } = await import("node:readline");

  const body = response.body;
  if (!body) {
    throw new Error("Empty response body from cross-references download.");
  }

  const gunzip = createGunzip();
  const readable = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  const decompressed = readable.pipe(gunzip);

  const rl = createInterface({ input: decompressed });

  const map = new Map<string, string[]>();

  for await (const line of rl) {
    if (!line || line.startsWith("#")) continue;
    const [from, to] = line.split("\t");
    if (!from || !to) continue;

    const fromRef = from.trim();
    const existing = map.get(fromRef);
    if (existing) {
      existing.push(to.trim());
    } else {
      map.set(fromRef, [to.trim()]);
    }
  }

  crossRefMap = map;
  return map;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates Bible cross-reference tools (OpenBible.info dataset, CC-BY license). */
export function createCrossRefTools(): BuiltinTool[] {
  return [
    // ----- bible_cross_references -----
    {
      name: "bible_cross_references",
      description:
        "Find cross-references for a Bible verse using the OpenBible.info dataset (~340K references). " +
        "Given a verse like \"John 3:16\", returns other verses that share themes, events, or language. " +
        "Data sourced from the Treasury of Scripture Knowledge. First call may take a few seconds to load data.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          reference: {
            type: "string",
            description:
              'Bible verse reference (e.g. "Genesis 1:1", "John 3:16", "Psalm 23:1")',
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of cross-references to return (default: 15, max: 50)",
          },
        },
        required: ["reference"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const reference = args.reference as string | undefined;
        if (!reference) {
          throw new Error("The 'reference' parameter is required.");
        }

        const rawMax = (args.max_results as number) ?? 15;
        const maxResults = Math.min(Math.max(1, rawMax), 50);

        const map = await loadCrossReferences();

        // Try OSIS format first, then try converting from human format
        let osisRef = humanToOsis(reference);
        let refs = map.get(osisRef);

        // If not found, try the reference as-is (in case it's already OSIS)
        if (!refs) {
          refs = map.get(reference);
        }

        if (!refs || refs.length === 0) {
          return `No cross-references found for "${reference}". Try a specific verse (e.g. "John 3:16").`;
        }

        const shown = refs.slice(0, maxResults);
        const lines: string[] = [
          `Cross-references for ${reference} (${shown.length} of ${refs.length}):`,
          "",
        ];

        for (let i = 0; i < shown.length; i++) {
          lines.push(`${i + 1}. ${osisToHuman(shown[i])}`);
        }

        if (refs.length > maxResults) {
          lines.push(
            "",
            `... and ${refs.length - maxResults} more. Increase max_results to see all.`,
          );
        }

        return lines.join("\n");
      },
    },
  ];
}
