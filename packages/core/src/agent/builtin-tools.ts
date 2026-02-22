import type { AgentTool } from "./types.js";
import type { PolicyLevel } from "./tool-policy.js";

/**
 * Built-in tools available to the agent runtime.
 */

/**
 * Extended tool interface that includes a default policy level.
 */
export interface BuiltinTool extends AgentTool {
  defaultPolicy: PolicyLevel;
}

// ---------------------------------------------------------------------------
// web_fetch
// ---------------------------------------------------------------------------

export const webFetchTool: BuiltinTool = {
  name: "web_fetch",
  description:
    "Fetch the contents of a URL and return the response as text. " +
    "Use this to look up current information such as weather, news, or documentation.",
  defaultPolicy: "allow",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
    },
    required: ["url"],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const url = args.url as string;
    if (!url) {
      throw new Error("url is required");
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "Haya/0.1" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();

    const MAX_LENGTH = 16_000;
    if (text.length > MAX_LENGTH) {
      return `${text.slice(0, MAX_LENGTH)}\n\n[Truncated — ${text.length} chars total]`;
    }

    return text;
  },
};

// ---------------------------------------------------------------------------
// shell_exec
// ---------------------------------------------------------------------------

export const shellExecTool: BuiltinTool = {
  name: "shell_exec",
  description:
    "Execute a shell command and return the output. " +
    "The command runs with shell:false for safety. Provide the command as the program name and args separately.",
  defaultPolicy: "confirm",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The program to execute (e.g., 'ls', 'cat', 'grep')",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments to pass to the command",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command (optional)",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["command"],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const { safeExecSync } = await import("../security/command-exec.js");
    const command = args.command as string;
    if (!command) throw new Error("command is required");

    const cmdArgs = (args.args as string[]) ?? [];
    const cwd = args.cwd as string | undefined;
    const timeout = (args.timeout as number) ?? 30_000;

    // If workspace guard is available, validate cwd
    if (cwd) {
      const { WorkspaceGuard } = await import("../security/workspace.js");
      const workspace = (args as Record<string, unknown>).__workspace as string | undefined;
      if (workspace) {
        const guard = new WorkspaceGuard([workspace]);
        guard.validatePath(cwd);
      }
    }

    const output = safeExecSync(command, cmdArgs, { cwd, timeout });
    const MAX_LENGTH = 16_000;
    if (output.length > MAX_LENGTH) {
      return `${output.slice(0, MAX_LENGTH)}\n\n[Truncated — ${output.length} chars total]`;
    }
    return output;
  },
};

// ---------------------------------------------------------------------------
// file_read
// ---------------------------------------------------------------------------

export const fileReadTool: BuiltinTool = {
  name: "file_read",
  description: "Read the contents of a file and return it as text.",
  defaultPolicy: "allow",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read",
      },
    },
    required: ["path"],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const filePath = args.path as string;
    if (!filePath) throw new Error("path is required");

    const content = readFileSync(filePath, "utf-8");
    const MAX_LENGTH = 16_000;
    if (content.length > MAX_LENGTH) {
      return `${content.slice(0, MAX_LENGTH)}\n\n[Truncated — ${content.length} chars total]`;
    }
    return content;
  },
};

// ---------------------------------------------------------------------------
// file_write
// ---------------------------------------------------------------------------

export const fileWriteTool: BuiltinTool = {
  name: "file_write",
  description: "Write content to a file, creating it if it does not exist.",
  defaultPolicy: "confirm",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");

    const filePath = args.path as string;
    const content = args.content as string;
    if (!filePath) throw new Error("path is required");
    if (content === undefined) throw new Error("content is required");

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, { mode: 0o600 });
    return `Wrote ${content.length} bytes to ${filePath}`;
  },
};

// ---------------------------------------------------------------------------
// file_list
// ---------------------------------------------------------------------------

export const fileListTool: BuiltinTool = {
  name: "file_list",
  description: "List files and directories at a given path.",
  defaultPolicy: "allow",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path to list (default: current directory)",
      },
    },
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const { readdirSync, statSync } = await import("node:fs");
    const dirPath = (args.path as string) ?? ".";

    const entries = readdirSync(dirPath);
    const lines: string[] = [];
    for (const entry of entries) {
      try {
        const { join } = await import("node:path");
        const fullPath = join(dirPath, entry);
        const stat = statSync(fullPath);
        const type = stat.isDirectory() ? "dir" : "file";
        const size = stat.isFile() ? ` (${stat.size} bytes)` : "";
        lines.push(`${type}\t${entry}${size}`);
      } catch {
        lines.push(`?\t${entry}`);
      }
    }
    return lines.join("\n") || "(empty directory)";
  },
};

// ---------------------------------------------------------------------------
// browser_action (stub — requires optional playwright dependency)
// ---------------------------------------------------------------------------

export const browserActionTool: BuiltinTool = {
  name: "browser_action",
  description:
    "Perform a browser action using Playwright. Supports: navigate, click, type, screenshot, extract_text. " +
    "Requires playwright to be installed as a peer dependency.",
  defaultPolicy: "confirm",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["navigate", "click", "type", "screenshot", "extract_text"],
        description: "The browser action to perform",
      },
      url: { type: "string", description: "URL for navigate action" },
      selector: { type: "string", description: "CSS selector for click/type actions" },
      text: { type: "string", description: "Text for type action" },
    },
    required: ["action"],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    if (!action) throw new Error("action is required");

    // Lazy-load playwright
    let playwright: Record<string, unknown>;
    try {
      playwright = await import("playwright");
    } catch {
      throw new Error(
        "Playwright is not installed. Install it with: pnpm add playwright",
      );
    }

    const chromium = playwright.chromium as {
      launch: () => Promise<{
        newPage: () => Promise<Record<string, unknown>>;
        close: () => Promise<void>;
      }>;
    };
    const browser = await chromium.launch();
    const page = await browser.newPage() as Record<string, (...a: unknown[]) => Promise<unknown>>;

    try {
      switch (action) {
        case "navigate": {
          const url = args.url as string;
          if (!url) throw new Error("url is required for navigate");
          await page.goto(url);
          const title = await page.title();
          return `Navigated to ${url} — title: ${title}`;
        }
        case "click": {
          const selector = args.selector as string;
          if (!selector) throw new Error("selector is required for click");
          await page.click(selector);
          return `Clicked: ${selector}`;
        }
        case "type": {
          const selector = args.selector as string;
          const text = args.text as string;
          if (!selector) throw new Error("selector is required for type");
          if (!text) throw new Error("text is required for type");
          await page.fill(selector, text);
          return `Typed into ${selector}`;
        }
        case "screenshot": {
          const buffer = await page.screenshot() as Buffer;
          return `Screenshot taken (${buffer.length} bytes)`;
        }
        case "extract_text": {
          const text = await page.evaluate(
            "document.body.innerText",
          ) as string;
          const MAX = 16_000;
          if (text.length > MAX) {
            return `${text.slice(0, MAX)}\n\n[Truncated — ${text.length} chars total]`;
          }
          return text;
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } finally {
      await browser.close();
    }
  },
};

// ---------------------------------------------------------------------------
// Session tools factory (inter-agent communication)
// ---------------------------------------------------------------------------

export function createSessionTools(sessionsDir: string): BuiltinTool[] {
  return [
    {
      name: "sessions_send",
      description:
        "Send a message to another session. Useful for inter-agent communication.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          targetSessionId: {
            type: "string",
            description: "The session ID to send the message to",
          },
          message: {
            type: "string",
            description: "The message content to send",
          },
        },
        required: ["targetSessionId", "message"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const { SessionStore } = await import("../sessions/store.js");
        const targetSessionId = args.targetSessionId as string;
        const message = args.message as string;
        if (!targetSessionId) throw new Error("targetSessionId is required");
        if (!message) throw new Error("message is required");

        const store = new SessionStore(sessionsDir);
        if (!store.exists(targetSessionId)) {
          store.create(targetSessionId);
        }
        store.appendMessage(targetSessionId, {
          role: "user",
          content: message,
          timestamp: Date.now(),
        });
        return `Message sent to session ${targetSessionId}`;
      },
    },
    {
      name: "sessions_history",
      description:
        "Read the message history of another session.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          targetSessionId: {
            type: "string",
            description: "The session ID to read history from",
          },
          limit: {
            type: "number",
            description: "Maximum number of messages to return (default: 20)",
          },
        },
        required: ["targetSessionId"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const { SessionStore } = await import("../sessions/store.js");
        const targetSessionId = args.targetSessionId as string;
        if (!targetSessionId) throw new Error("targetSessionId is required");

        const store = new SessionStore(sessionsDir);
        if (!store.exists(targetSessionId)) {
          return `Session ${targetSessionId} not found`;
        }

        const messages = store.readMessages(targetSessionId);
        const limit = (args.limit as number) ?? 20;
        const recent = messages.slice(-limit);

        const lines = recent.map(
          (m) => `[${m.role}] ${m.content}`,
        );
        return lines.join("\n") || "(no messages)";
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Default tool policies derived from builtin tools
// ---------------------------------------------------------------------------

export const defaultToolPolicies = [
  { toolName: "web_fetch", level: "allow" as PolicyLevel },
  { toolName: "shell_exec", level: "confirm" as PolicyLevel },
  { toolName: "file_read", level: "allow" as PolicyLevel },
  { toolName: "file_write", level: "confirm" as PolicyLevel },
  { toolName: "file_list", level: "allow" as PolicyLevel },
  { toolName: "browser_action", level: "confirm" as PolicyLevel },
  { toolName: "sessions_send", level: "confirm" as PolicyLevel },
  { toolName: "sessions_history", level: "confirm" as PolicyLevel },
  { toolName: "memory_store", level: "allow" as PolicyLevel },
  { toolName: "memory_search", level: "allow" as PolicyLevel },
  { toolName: "memory_delete", level: "confirm" as PolicyLevel },
  { toolName: "reminder_set", level: "confirm" as PolicyLevel },
  { toolName: "reminder_list", level: "allow" as PolicyLevel },
  { toolName: "reminder_cancel", level: "confirm" as PolicyLevel },
  { toolName: "web_search", level: "allow" as PolicyLevel },
  { toolName: "image_generate", level: "confirm" as PolicyLevel },
  { toolName: "message_send", level: "confirm" as PolicyLevel },
  { toolName: "message_broadcast", level: "confirm" as PolicyLevel },
  { toolName: "channels_list", level: "allow" as PolicyLevel },
  { toolName: "gateway_status", level: "allow" as PolicyLevel },
  { toolName: "gateway_config", level: "allow" as PolicyLevel },
  { toolName: "link_preview", level: "allow" as PolicyLevel },
  { toolName: "auto_reply_add", level: "confirm" as PolicyLevel },
  { toolName: "auto_reply_list", level: "allow" as PolicyLevel },
  { toolName: "auto_reply_remove", level: "confirm" as PolicyLevel },
  { toolName: "image_analyze", level: "allow" as PolicyLevel },
];

/** All built-in tools (excludes session tools which need runtime config). */
export const builtinTools: BuiltinTool[] = [
  webFetchTool,
  shellExecTool,
  fileReadTool,
  fileWriteTool,
  fileListTool,
  browserActionTool,
];

export { createMapsTools } from "./maps-tools.js";
export { createMemoryTools } from "./memory-tools.js";
export { createReminderTools } from "./reminder-tools.js";
export { createSearchTools } from "./search-tools.js";
export { createImageTools } from "./image-tools.js";
export { createMessageTools } from "./message-tools.js";
export { createGatewayTools } from "./gateway-tools.js";
export type { GatewayToolContext } from "./gateway-tools.js";
export { createVisionTools } from "./vision-tools.js";
export { createAutoReplyTools } from "./auto-reply-tools.js";
export { createLinkTools } from "./link-tools.js";
export { createGeminiProvider } from "./gemini.js";
