import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { safeExecSync } from "../security/command-exec.js";
import type { BuiltinTool } from "./builtin-tools.js";

const MAX_RESPONSE_LENGTH = 16_000;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".log",
  ".json",
  ".xml",
  ".html",
]);

/**
 * Parse a CSV line, handling quoted fields that may contain commas.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
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
}

/**
 * Format parsed CSV rows as an aligned Markdown table.
 */
function formatCsvTable(rows: string[][]): string {
  if (rows.length === 0) return "(empty CSV file)";

  // Calculate column widths
  const colCount = Math.max(...rows.map((r) => r.length));
  const widths: number[] = Array.from({ length: colCount }, () => 0);

  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      const cell = row[i] ?? "";
      widths[i] = Math.max(widths[i], cell.length);
    }
  }

  // Ensure minimum width of 3 for separator
  for (let i = 0; i < widths.length; i++) {
    widths[i] = Math.max(widths[i], 3);
  }

  const formatRow = (row: string[]): string => {
    const cells = widths.map((w, i) => (row[i] ?? "").padEnd(w));
    return `| ${cells.join(" | ")} |`;
  };

  const separator = `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`;

  const lines: string[] = [];
  lines.push(formatRow(rows[0]));
  lines.push(separator);
  for (let i = 1; i < rows.length; i++) {
    lines.push(formatRow(rows[i]));
  }

  return lines.join("\n");
}

/**
 * Basic fallback PDF text extraction.
 * Attempts to extract readable text from raw PDF content by looking for
 * text between parentheses in content streams (between stream/endstream markers).
 */
function extractPdfTextFallback(raw: string): string {
  const texts: string[] = [];

  // Find content between stream and endstream markers
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(raw)) !== null) {
    const streamContent = match[1];

    // Extract text from BT...ET blocks (text objects)
    const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let btMatch: RegExpExecArray | null;

    while ((btMatch = btEtRegex.exec(streamContent)) !== null) {
      const textBlock = btMatch[1];

      // Extract text between parentheses (Tj/TJ operators)
      const parenRegex = /\(([^)]*)\)/g;
      let parenMatch: RegExpExecArray | null;

      while ((parenMatch = parenRegex.exec(textBlock)) !== null) {
        const text = parenMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\\(/g, "(")
          .replace(/\\\)/g, ")")
          .replace(/\\\\/g, "\\");
        if (text.trim()) {
          texts.push(text);
        }
      }
    }
  }

  return texts.join(" ").trim() || "(No readable text could be extracted from PDF)";
}

/**
 * Truncate output if it exceeds the maximum response length.
 */
function truncate(text: string): string {
  if (text.length > MAX_RESPONSE_LENGTH) {
    return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
  }
  return text;
}

/**
 * Create the PDF/text extraction tool.
 */
export function createPdfTools(): BuiltinTool[] {
  return [
    {
      name: "pdf_extract",
      description:
        "Extract text content from PDF, CSV, and plain text files. " +
        "For PDF files, extracts all readable text. " +
        "For CSV files, parses and formats as a readable table.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to extract text from",
          },
        },
        required: ["path"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const filePath = args.path as string;
        if (!filePath) throw new Error("path is required");

        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        const ext = extname(filePath).toLowerCase();

        // PDF extraction
        if (ext === ".pdf") {
          try {
            const output = safeExecSync("pdftotext", [filePath, "-"]);
            return truncate(output);
          } catch {
            // Fallback: read raw file and attempt basic extraction
            const raw = readFileSync(filePath, "latin1");
            const text = extractPdfTextFallback(raw);
            return truncate(text);
          }
        }

        // CSV extraction
        if (ext === ".csv") {
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
          if (lines.length === 0) {
            return "(empty CSV file)";
          }
          const rows = lines.map(parseCsvLine);
          const table = formatCsvTable(rows);
          return truncate(table);
        }

        // Plain text / structured text files
        if (TEXT_EXTENSIONS.has(ext)) {
          const content = readFileSync(filePath, "utf-8");
          return truncate(content);
        }

        // Unsupported format
        return (
          `Unsupported file format: ${ext}\n` +
          "Supported formats: .pdf, .csv, .txt, .md, .log, .json, .xml, .html"
        );
      },
    },
  ];
}
