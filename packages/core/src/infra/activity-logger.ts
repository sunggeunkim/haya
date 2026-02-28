import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { redactSensitive } from "./logger.js";

/** Configuration for the activity logger. */
export interface ActivityLoggerConfig {
  dir: string;
  maxSizeMB: number;
  maxFiles: number;
  redactSecrets?: boolean;
}

/** A tool execution log record. */
export interface ToolLogRecord {
  type: "tool";
  timestamp: number;
  sessionId?: string;
  toolName: string;
  args: unknown;
  result: string;
  isError: boolean;
  durationMs: number;
}

/** An LLM provider call log record. */
export interface ProviderLogRecord {
  type: "provider";
  timestamp: number;
  sessionId: string;
  model: string;
  round: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  finishReason: string;
  durationMs: number;
  toolCallCount: number;
}

/** A conversation activity log record. */
export interface ActivityLogRecord {
  type: "activity";
  timestamp: number;
  sessionId: string;
  channel: string;
  senderId: string;
  messagePreview: string;
  responsePreview: string;
  totalTokens?: number;
  toolsUsed: string[];
  totalDurationMs: number;
}

/** Interface for activity logging (allows null-object pattern). */
export interface IActivityLogger {
  logTool(record: Omit<ToolLogRecord, "type" | "timestamp">): void;
  logProvider(record: Omit<ProviderLogRecord, "type" | "timestamp">): void;
  logActivity(record: Omit<ActivityLogRecord, "type" | "timestamp">): void;
}

/** No-op activity logger for tests and disabled logging. */
export const noopActivityLogger: IActivityLogger = {
  logTool() {},
  logProvider() {},
  logActivity() {},
};

const TOOLS_FILE = "tools.jsonl";
const PROVIDER_FILE = "provider.jsonl";
const ACTIVITY_FILE = "activity.jsonl";

/**
 * Structured activity logger that writes JSONL files with automatic rotation.
 * Creates three log files: tools.jsonl, provider.jsonl, activity.jsonl.
 */
export class ActivityLogger implements IActivityLogger {
  private readonly dir: string;
  private readonly maxSizeBytes: number;
  private readonly maxFiles: number;
  private readonly redactSecrets: boolean;

  constructor(config: ActivityLoggerConfig) {
    this.dir = config.dir;
    this.maxSizeBytes = config.maxSizeMB * 1024 * 1024;
    this.maxFiles = config.maxFiles;
    this.redactSecrets = config.redactSecrets ?? true;

    // Create log directory with secure permissions
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });

    // Touch log files with secure permissions
    for (const file of [TOOLS_FILE, PROVIDER_FILE, ACTIVITY_FILE]) {
      const filePath = join(this.dir, file);
      if (!existsSync(filePath)) {
        writeFileSync(filePath, "", { mode: 0o600 });
      }
    }
  }

  /** Log a tool execution event. */
  logTool(record: Omit<ToolLogRecord, "type" | "timestamp">): void {
    const full: ToolLogRecord = {
      type: "tool",
      timestamp: Date.now(),
      ...record,
      args: this.redactSecrets ? redactSensitive(record.args) : record.args,
    };
    this.append(TOOLS_FILE, full);
  }

  /** Log an LLM provider call. */
  logProvider(record: Omit<ProviderLogRecord, "type" | "timestamp">): void {
    const full: ProviderLogRecord = {
      type: "provider",
      timestamp: Date.now(),
      ...record,
    };
    this.append(PROVIDER_FILE, full);
  }

  /** Log a conversation activity event. */
  logActivity(record: Omit<ActivityLogRecord, "type" | "timestamp">): void {
    const full: ActivityLogRecord = {
      type: "activity",
      timestamp: Date.now(),
      ...record,
    };
    this.append(ACTIVITY_FILE, full);
  }

  private append(fileName: string, record: unknown): void {
    const filePath = join(this.dir, fileName);
    appendFileSync(filePath, JSON.stringify(record) + "\n");
    this.rotateIfNeeded(filePath, fileName);
  }

  /** Rotate log file if it exceeds maxSizeMB. */
  private rotateIfNeeded(filePath: string, fileName: string): void {
    try {
      const stats = statSync(filePath);
      if (stats.size <= this.maxSizeBytes) return;
    } catch {
      return;
    }

    // Shift existing rotated files: .N.jsonl → .(N+1).jsonl
    const baseName = fileName.replace(/\.jsonl$/, "");
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = join(this.dir, `${baseName}.${i}.jsonl`);
      const dst = join(this.dir, `${baseName}.${i + 1}.jsonl`);
      if (existsSync(src)) {
        if (i + 1 > this.maxFiles) {
          unlinkSync(src);
        } else {
          renameSync(src, dst);
        }
      }
    }

    // Move current file to .1.jsonl
    renameSync(filePath, join(this.dir, `${baseName}.1.jsonl`));

    // Create fresh empty file
    writeFileSync(filePath, "", { mode: 0o600 });
  }
}
