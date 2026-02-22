import type { BuiltinTool } from "./builtin-tools.js";

const MAX_RESPONSE_LENGTH = 16_000;

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function parseCsv(input: string): Record<string, string>[] {
  const lines = input.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  };

  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function toCsv(data: unknown): string {
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) return "";

  const headers = Object.keys(arr[0] as Record<string, unknown>);
  const escapeField = (value: unknown): string => {
    const str = String(value ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.map(escapeField).join(",")];
  for (const row of arr) {
    const obj = row as Record<string, unknown>;
    lines.push(headers.map((h) => escapeField(obj[h])).join(","));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// YAML helpers
// ---------------------------------------------------------------------------

function parseYaml(input: string): unknown {
  const lines = input.split("\n");
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;

  for (const rawLine of lines) {
    // Skip blank lines and comments
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) continue;

    const indent = rawLine.length - rawLine.trimStart().length;
    const trimmed = rawLine.trim();

    // Array item
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim();
      if (currentKey !== null && currentArray !== null) {
        currentArray.push(parseYamlValue(value));
      }
      continue;
    }

    // Key: value
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();

      // Finish any previous array
      if (currentKey !== null && currentArray !== null) {
        result[currentKey] = currentArray;
        currentArray = null;
        currentKey = null;
      }

      if (rawValue === "") {
        // Could be start of an array or nested object — check next lines
        currentKey = key;
        currentArray = [];
      } else if (indent > 0 && currentKey !== null && currentArray === null) {
        // Nested object
        if (typeof result[currentKey] !== "object" || Array.isArray(result[currentKey])) {
          result[currentKey] = {} as Record<string, unknown>;
        }
        (result[currentKey] as Record<string, unknown>)[key] = parseYamlValue(rawValue);
      } else {
        if (currentKey !== null && currentArray !== null && currentArray.length === 0) {
          // Empty array was actually a nested object start
          result[currentKey] = {} as Record<string, unknown>;
          (result[currentKey] as Record<string, unknown>)[key] = parseYamlValue(rawValue);
          currentArray = null;
          // keep currentKey for additional nested keys
          continue;
        }
        currentKey = null;
        currentArray = null;
        result[key] = parseYamlValue(rawValue);
      }
    }
  }

  // Flush any trailing array
  if (currentKey !== null && currentArray !== null) {
    result[currentKey] = currentArray;
  }

  return result;
}

function parseYamlValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;

  // Remove surrounding quotes
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  const num = Number(raw);
  if (!Number.isNaN(num) && raw !== "") return num;

  return raw;
}

function toYaml(data: unknown, indent: number = 0): string {
  const prefix = "  ".repeat(indent);

  if (data === null || data === undefined) return `${prefix}null\n`;
  if (typeof data === "boolean" || typeof data === "number") {
    return `${prefix}${data}\n`;
  }
  if (typeof data === "string") {
    if (
      data.includes(":") ||
      data.includes("#") ||
      data.includes("\n") ||
      data.includes('"') ||
      data.includes("'") ||
      data === "true" ||
      data === "false" ||
      data === "null" ||
      data === ""
    ) {
      return `${prefix}"${data.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n`;
    }
    return `${prefix}${data}\n`;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return `${prefix}[]\n`;
    let out = "";
    for (const item of data) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const objLines = toYaml(item, indent + 1).trimStart();
        out += `${prefix}- ${objLines}`;
      } else {
        const val = toYaml(item, 0).trim();
        out += `${prefix}- ${val}\n`;
      }
    }
    return out;
  }
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return `${prefix}{}\n`;
    let out = "";
    for (const key of keys) {
      const value = obj[key];
      if (
        typeof value === "object" &&
        value !== null &&
        (Array.isArray(value) || Object.keys(value).length > 0)
      ) {
        out += `${prefix}${key}:\n`;
        out += toYaml(value, indent + 1);
      } else {
        const val = toYaml(value, 0).trim();
        out += `${prefix}${key}: ${val}\n`;
      }
    }
    return out;
  }

  return `${prefix}${String(data)}\n`;
}

// ---------------------------------------------------------------------------
// TOML helpers
// ---------------------------------------------------------------------------

function parseToml(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = result;

  const lines = input.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    // Section header [section]
    if (line.startsWith("[") && line.endsWith("]")) {
      const sectionName = line.slice(1, -1).trim();
      if (!(sectionName in result)) {
        result[sectionName] = {};
      }
      currentSection = result[sectionName] as Record<string, unknown>;
      continue;
    }

    // Key = value
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    const rawValue = line.slice(eqIdx + 1).trim();

    currentSection[key] = parseTomlValue(rawValue);
  }

  return result;
}

function parseTomlValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;

  // String
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  // Array
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseTomlValue(item.trim()));
  }

  const num = Number(raw);
  if (!Number.isNaN(num) && raw !== "") return num;

  return raw;
}

function toToml(data: unknown, sectionPrefix: string = ""): string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return String(data);
  }

  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  let topLevel = "";
  let sections = "";

  for (const key of keys) {
    const value = obj[key];
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const sectionName = sectionPrefix ? `${sectionPrefix}.${key}` : key;
      sections += `[${sectionName}]\n`;
      const nested = value as Record<string, unknown>;
      for (const nk of Object.keys(nested)) {
        sections += `${nk} = ${toTomlValue(nested[nk])}\n`;
      }
      sections += "\n";
    } else {
      topLevel += `${key} = ${toTomlValue(value)}\n`;
    }
  }

  return (topLevel + (topLevel && sections ? "\n" : "") + sections).trimEnd() + "\n";
}

function toTomlValue(value: unknown): string {
  if (typeof value === "string") return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === null || value === undefined) return '""';
  if (Array.isArray(value)) {
    return `[${value.map(toTomlValue).join(", ")}]`;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

/**
 * Compute the Longest Common Subsequence table for two arrays of strings.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

interface DiffLine {
  type: " " | "+" | "-";
  text: string;
}

/**
 * Back-trace the LCS table to produce a list of diff lines.
 */
function buildDiff(a: string[], b: string[], dp: number[][]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: " ", text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "+", text: b[j - 1] });
      j--;
    } else {
      result.push({ type: "-", text: a[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Format diff lines with context, similar to unified diff output.
 */
function formatUnifiedDiff(
  diffLines: DiffLine[],
  contextLines: number,
): string {
  // Find indices of changed lines
  const changedIndices = new Set<number>();
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type !== " ") {
      changedIndices.add(i);
    }
  }

  if (changedIndices.size === 0) {
    return "No differences found.";
  }

  // Mark which lines to include (changed + context)
  const include = new Set<number>();
  for (const idx of changedIndices) {
    for (
      let c = Math.max(0, idx - contextLines);
      c <= Math.min(diffLines.length - 1, idx + contextLines);
      c++
    ) {
      include.add(c);
    }
  }

  const lines: string[] = [];
  let lastIncluded = -2;

  for (let i = 0; i < diffLines.length; i++) {
    if (!include.has(i)) continue;

    if (lastIncluded !== i - 1 && lastIncluded !== -2) {
      lines.push("...");
    }

    const dl = diffLines[i];
    lines.push(`${dl.type}${dl.text}`);
    lastIncluded = i;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parsers dispatch
// ---------------------------------------------------------------------------

type Format = "json" | "csv" | "yaml" | "toml";

function parseInput(input: string, format: Format): unknown {
  switch (format) {
    case "json":
      return JSON.parse(input);
    case "csv":
      return parseCsv(input);
    case "yaml":
      return parseYaml(input);
    case "toml":
      return parseToml(input);
    default:
      throw new Error(`Unsupported input format: ${format as string}`);
  }
}

function formatOutput(data: unknown, format: Format): string {
  switch (format) {
    case "json":
      return JSON.stringify(data, null, 2);
    case "csv":
      return toCsv(data);
    case "yaml":
      return toYaml(data).trimEnd();
    case "toml":
      return toToml(data).trimEnd();
    default:
      throw new Error(`Unsupported output format: ${format as string}`);
  }
}

function capOutput(output: string): string {
  if (output.length > MAX_RESPONSE_LENGTH) {
    return `${output.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${output.length} chars total]`;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Create data conversion and text diff tools.
 */
export function createDataTools(): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------
    // data_convert
    // -----------------------------------------------------------------
    {
      name: "data_convert",
      description:
        "Convert data between formats: JSON, CSV, YAML, TOML. " +
        "Parses the input in the source format and outputs in the target format.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "The input data as a string",
          },
          from: {
            type: "string",
            enum: ["json", "csv", "yaml", "toml"],
            description: "The source format",
          },
          to: {
            type: "string",
            enum: ["json", "csv", "yaml", "toml"],
            description: "The target format",
          },
        },
        required: ["input", "from", "to"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const input = args.input as string;
        const from = args.from as Format;
        const to = args.to as Format;

        if (!input && input !== "") throw new Error("input is required");
        if (!from) throw new Error("from is required");
        if (!to) throw new Error("to is required");

        const validFormats: Format[] = ["json", "csv", "yaml", "toml"];
        if (!validFormats.includes(from)) {
          throw new Error(`Unsupported source format: ${from}`);
        }
        if (!validFormats.includes(to)) {
          throw new Error(`Unsupported target format: ${to}`);
        }

        if (input.trim() === "") {
          return "";
        }

        const data = parseInput(input, from);
        const output = formatOutput(data, to);
        return capOutput(output);
      },
    },

    // -----------------------------------------------------------------
    // text_diff
    // -----------------------------------------------------------------
    {
      name: "text_diff",
      description:
        "Compare two texts and show the differences line by line. " +
        "Returns a unified diff-style output.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          text_a: {
            type: "string",
            description: "The first text to compare",
          },
          text_b: {
            type: "string",
            description: "The second text to compare",
          },
          context_lines: {
            type: "number",
            description:
              "Number of context lines to show around changes (default: 3)",
          },
        },
        required: ["text_a", "text_b"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const textA = (args.text_a as string) ?? "";
        const textB = (args.text_b as string) ?? "";
        const contextLines = (args.context_lines as number) ?? 3;

        const linesA = textA.split("\n");
        const linesB = textB.split("\n");

        const dp = lcsTable(linesA, linesB);
        const diffLines = buildDiff(linesA, linesB, dp);
        const output = formatUnifiedDiff(diffLines, contextLines);

        return capOutput(output);
      },
    },
  ];
}
