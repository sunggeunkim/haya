import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSystemPrompt } from "./prompt-loader.js";

describe("loadSystemPrompt", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `haya-prompt-test-${randomBytes(8).toString("hex")}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads a single file", () => {
    const filePath = join(tempDir, "system.md");
    writeFileSync(filePath, "You are a helpful bot.");

    const result = loadSystemPrompt({
      promptFiles: [filePath],
    });

    expect(result).toBe("You are a helpful bot.");
  });

  it("loads multiple files concatenated with double newline", () => {
    const file1 = join(tempDir, "base.md");
    const file2 = join(tempDir, "extra.md");
    writeFileSync(file1, "Base instructions.");
    writeFileSync(file2, "Extra instructions.");

    const result = loadSystemPrompt({
      promptFiles: [file1, file2],
    });

    expect(result).toBe("Base instructions.\n\nExtra instructions.");
  });

  it("combines inline prompt with files", () => {
    const filePath = join(tempDir, "rules.md");
    writeFileSync(filePath, "Follow these rules.");

    const result = loadSystemPrompt({
      inlinePrompt: "You are a helpful assistant.",
      promptFiles: [filePath],
    });

    expect(result).toBe("You are a helpful assistant.\n\nFollow these rules.");
  });

  it("throws error for missing file", () => {
    expect(() =>
      loadSystemPrompt({
        promptFiles: [join(tempDir, "nonexistent.md")],
      }),
    ).toThrow(/System prompt file not found/);
  });

  it("skips empty file content", () => {
    const emptyFile = join(tempDir, "empty.md");
    const contentFile = join(tempDir, "content.md");
    writeFileSync(emptyFile, "   \n  \n  ");
    writeFileSync(contentFile, "Real content.");

    const result = loadSystemPrompt({
      promptFiles: [emptyFile, contentFile],
    });

    expect(result).toBe("Real content.");
  });

  it("returns empty string when no inline prompt or files", () => {
    const result = loadSystemPrompt({});
    expect(result).toBe("");
  });

  it("returns only inline prompt when no files provided", () => {
    const result = loadSystemPrompt({
      inlinePrompt: "Just inline.",
    });
    expect(result).toBe("Just inline.");
  });

  it("resolves files relative to basePath", () => {
    const subDir = join(tempDir, "prompts");
    mkdirSync(subDir, { recursive: true });
    const filePath = join(subDir, "system.md");
    writeFileSync(filePath, "Resolved content.");

    const result = loadSystemPrompt({
      promptFiles: ["prompts/system.md"],
      basePath: tempDir,
    });

    expect(result).toBe("Resolved content.");
  });
});
