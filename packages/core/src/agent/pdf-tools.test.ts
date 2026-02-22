import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { createPdfTools } from "./pdf-tools.js";
import type { AgentTool } from "./types.js";

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createPdfTools", () => {
  it("returns exactly 1 tool", () => {
    const tools = createPdfTools();
    expect(tools).toHaveLength(1);
  });

  it("returns a tool named pdf_extract", () => {
    const tools = createPdfTools();
    expect(tools[0].name).toBe("pdf_extract");
  });

  it("has a path parameter", () => {
    const tools = createPdfTools();
    const tool = getTool(tools, "pdf_extract");
    const props = tool.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("path");
    expect(tool.parameters.required).toEqual(["path"]);
  });
});

// ---------------------------------------------------------------------------
// pdf_extract
// ---------------------------------------------------------------------------

describe("pdf_extract", () => {
  let tool: AgentTool;
  const tmpFiles: string[] = [];

  function writeTmp(name: string, content: string): string {
    const path = `/tmp/haya-test-${Date.now()}-${name}`;
    writeFileSync(path, content, "utf-8");
    tmpFiles.push(path);
    return path;
  }

  beforeEach(() => {
    tool = getTool(createPdfTools(), "pdf_extract");
  });

  // Clean up temp files after all tests
  afterAll(() => {
    for (const f of tmpFiles) {
      try {
        unlinkSync(f);
      } catch {
        // ignore
      }
    }
  });

  // -------------------------------------------------------------------------
  // CSV extraction
  // -------------------------------------------------------------------------

  it("formats CSV as an aligned table", async () => {
    const csv = "Name,Age,City\nAlice,30,New York\nBob,25,London\n";
    const path = writeTmp("test.csv", csv);

    const result = await tool.execute({ path });

    expect(result).toContain("| Name");
    expect(result).toContain("| Age");
    expect(result).toContain("| City");
    expect(result).toContain("|---");
    expect(result).toContain("Alice");
    expect(result).toContain("30");
    expect(result).toContain("New York");
    expect(result).toContain("Bob");
    expect(result).toContain("25");
    expect(result).toContain("London");
  });

  it("handles CSV with quoted fields containing commas", async () => {
    const csv = 'Name,Description\nAlice,"Has a cat, dog"\nBob,"No pets"\n';
    const path = writeTmp("quoted.csv", csv);

    const result = await tool.execute({ path });

    expect(result).toContain("Has a cat, dog");
    expect(result).toContain("No pets");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
  });

  it("returns empty message for empty CSV file", async () => {
    const path = writeTmp("empty.csv", "");

    const result = await tool.execute({ path });

    expect(result).toBe("(empty CSV file)");
  });

  // -------------------------------------------------------------------------
  // Plain text file reading
  // -------------------------------------------------------------------------

  it("reads plain text files", async () => {
    const content = "Hello, this is a test text file.\nLine 2.";
    const path = writeTmp("sample.txt", content);

    const result = await tool.execute({ path });

    expect(result).toBe(content);
  });

  // -------------------------------------------------------------------------
  // JSON file reading
  // -------------------------------------------------------------------------

  it("reads JSON files", async () => {
    const content = '{"key": "value", "number": 42}';
    const path = writeTmp("data.json", content);

    const result = await tool.execute({ path });

    expect(result).toBe(content);
  });

  // -------------------------------------------------------------------------
  // Unsupported extension
  // -------------------------------------------------------------------------

  it("returns error message for unsupported extension", async () => {
    const path = writeTmp("archive.tar.gz", "binary-data");
    // rename won't work easily in tmp, so just create a file with an unsupported ext
    const unsupportedPath = writeTmp("image.png", "not-a-real-png");

    const result = await tool.execute({ path: unsupportedPath });

    expect(result).toContain("Unsupported file format");
    expect(result).toContain(".png");
    expect(result).toContain("Supported formats");
  });

  // -------------------------------------------------------------------------
  // Missing file
  // -------------------------------------------------------------------------

  it("throws error for missing file", async () => {
    await expect(
      tool.execute({ path: "/tmp/nonexistent-haya-test-file.txt" }),
    ).rejects.toThrow("File not found");
  });

  // -------------------------------------------------------------------------
  // Output truncation
  // -------------------------------------------------------------------------

  it("truncates output exceeding 16000 chars", async () => {
    const longContent = "X".repeat(20_000);
    const path = writeTmp("long.txt", longContent);

    const result = await tool.execute({ path });

    expect(result.length).toBeLessThan(20_000);
    expect(result).toContain("[Truncated");
    expect(result).toContain("20000 chars total");
  });

  // -------------------------------------------------------------------------
  // PDF fallback path
  // -------------------------------------------------------------------------

  it("handles PDF when pdftotext is not available (fallback)", async () => {
    // Create a minimal fake PDF-like content with text markers
    const fakePdf =
      "%PDF-1.4\n" +
      "stream\n" +
      "BT\n" +
      "(Hello World) Tj\n" +
      "ET\n" +
      "endstream\n";
    const path = writeTmp("sample.pdf", fakePdf);

    // Mock safeExecSync to simulate pdftotext not being available
    const commandExec = await import("../security/command-exec.js");
    const originalSafeExecSync = commandExec.safeExecSync;
    vi.spyOn(commandExec, "safeExecSync").mockImplementation(
      (cmd: string, args: readonly string[], opts?: unknown) => {
        if (cmd === "pdftotext") {
          throw new Error("pdftotext: command not found");
        }
        return originalSafeExecSync(cmd, args, opts as Parameters<typeof originalSafeExecSync>[2]);
      },
    );

    const result = await tool.execute({ path });

    expect(result).toContain("Hello World");

    vi.restoreAllMocks();
  });

  it("returns message when PDF has no extractable text in fallback", async () => {
    const fakePdf = "%PDF-1.4\nsome binary content\n";
    const path = writeTmp("empty.pdf", fakePdf);

    const commandExec = await import("../security/command-exec.js");
    vi.spyOn(commandExec, "safeExecSync").mockImplementation(() => {
      throw new Error("pdftotext: command not found");
    });

    const result = await tool.execute({ path });

    expect(result).toContain("No readable text could be extracted");

    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Missing path parameter
  // -------------------------------------------------------------------------

  it("throws when path is not provided", async () => {
    await expect(tool.execute({})).rejects.toThrow("path is required");
  });
});
