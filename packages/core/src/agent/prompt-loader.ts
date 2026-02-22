import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load system prompt from inline text and/or markdown files.
 * Files are resolved relative to basePath (config file directory).
 */
export function loadSystemPrompt(options: {
  inlinePrompt?: string;
  promptFiles?: string[];
  basePath?: string;
}): string {
  const parts: string[] = [];

  if (options.inlinePrompt) {
    parts.push(options.inlinePrompt);
  }

  if (options.promptFiles) {
    for (const file of options.promptFiles) {
      const filePath = options.basePath ? resolve(options.basePath, file) : file;
      if (!existsSync(filePath)) {
        throw new Error(`System prompt file not found: ${filePath}`);
      }
      const content = readFileSync(filePath, "utf-8").trim();
      if (content) {
        parts.push(content);
      }
    }
  }

  return parts.join("\n\n");
}
