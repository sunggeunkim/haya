import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityLogger, noopActivityLogger } from "./activity-logger.js";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "haya-activity-logger-"));
}

describe("ActivityLogger", () => {
  const tempDirs: string[] = [];

  function makeTempLogger(overrides?: Partial<{ maxSizeMB: number; maxFiles: number; redactSecrets: boolean }>): { logger: ActivityLogger; dir: string } {
    const dir = createTempDir();
    tempDirs.push(dir);
    const logger = new ActivityLogger({
      dir,
      maxSizeMB: overrides?.maxSizeMB ?? 10,
      maxFiles: overrides?.maxFiles ?? 5,
      redactSecrets: overrides?.redactSecrets ?? true,
    });
    return { logger, dir };
  }

  afterEach(() => {
    // Temp dirs are cleaned up by OS
  });

  it("creates log directory and empty files with correct permissions", () => {
    const dir = join(createTempDir(), "nested", "logs");
    tempDirs.push(dir);
    new ActivityLogger({ dir, maxSizeMB: 10, maxFiles: 5 });

    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "tools.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "provider.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "activity.jsonl"))).toBe(true);

    // Check file permissions (0o600 = 33152 on Linux)
    const stats = statSync(join(dir, "tools.jsonl"));
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("logTool writes valid JSONL with correct fields", () => {
    const { logger, dir } = makeTempLogger();

    logger.logTool({
      sessionId: "test-session",
      toolName: "weather",
      args: { city: "Seoul" },
      result: "5°C, cloudy",
      isError: false,
      durationMs: 342,
    });

    const content = readFileSync(join(dir, "tools.jsonl"), "utf-8").trim();
    const record = JSON.parse(content);
    expect(record.type).toBe("tool");
    expect(record.timestamp).toBeTypeOf("number");
    expect(record.sessionId).toBe("test-session");
    expect(record.toolName).toBe("weather");
    expect(record.result).toBe("5°C, cloudy");
    expect(record.isError).toBe(false);
    expect(record.durationMs).toBe(342);
  });

  it("logProvider writes valid JSONL with correct fields", () => {
    const { logger, dir } = makeTempLogger();

    logger.logProvider({
      sessionId: "test-session",
      model: "gpt-4o",
      round: 1,
      promptTokens: 1200,
      completionTokens: 85,
      totalTokens: 1285,
      finishReason: "stop",
      durationMs: 1823,
      toolCallCount: 0,
    });

    const content = readFileSync(join(dir, "provider.jsonl"), "utf-8").trim();
    const record = JSON.parse(content);
    expect(record.type).toBe("provider");
    expect(record.timestamp).toBeTypeOf("number");
    expect(record.sessionId).toBe("test-session");
    expect(record.model).toBe("gpt-4o");
    expect(record.round).toBe(1);
    expect(record.promptTokens).toBe(1200);
    expect(record.completionTokens).toBe(85);
    expect(record.totalTokens).toBe(1285);
    expect(record.finishReason).toBe("stop");
    expect(record.durationMs).toBe(1823);
    expect(record.toolCallCount).toBe(0);
  });

  it("logActivity writes valid JSONL with correct fields", () => {
    const { logger, dir } = makeTempLogger();

    logger.logActivity({
      sessionId: "slack-general",
      channel: "slack",
      senderId: "U12345",
      messagePreview: "What is the weather?",
      responsePreview: "The current weather is 5°C...",
      totalTokens: 1285,
      toolsUsed: ["weather"],
      totalDurationMs: 2540,
    });

    const content = readFileSync(join(dir, "activity.jsonl"), "utf-8").trim();
    const record = JSON.parse(content);
    expect(record.type).toBe("activity");
    expect(record.timestamp).toBeTypeOf("number");
    expect(record.sessionId).toBe("slack-general");
    expect(record.channel).toBe("slack");
    expect(record.senderId).toBe("U12345");
    expect(record.toolsUsed).toEqual(["weather"]);
    expect(record.totalDurationMs).toBe(2540);
  });

  it("multiple writes append correctly (N calls → N lines)", () => {
    const { logger, dir } = makeTempLogger();

    for (let i = 0; i < 5; i++) {
      logger.logTool({
        toolName: `tool-${i}`,
        args: {},
        result: "ok",
        isError: false,
        durationMs: i * 10,
      });
    }

    const lines = readFileSync(join(dir, "tools.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      const record = JSON.parse(lines[i]);
      expect(record.toolName).toBe(`tool-${i}`);
    }
  });

  it("redacts sensitive args when redactSecrets is enabled", () => {
    const { logger, dir } = makeTempLogger({ redactSecrets: true });

    logger.logTool({
      toolName: "api_call",
      args: { apiKey: "super-secret-key", city: "Seoul" },
      result: "ok",
      isError: false,
      durationMs: 100,
    });

    const content = readFileSync(join(dir, "tools.jsonl"), "utf-8").trim();
    const record = JSON.parse(content);
    expect(record.args.apiKey).toBe("[REDACTED]");
    expect(record.args.city).toBe("Seoul");
  });

  it("preserves args when redactSecrets is disabled", () => {
    const { logger, dir } = makeTempLogger({ redactSecrets: false });

    logger.logTool({
      toolName: "api_call",
      args: { apiKey: "super-secret-key", city: "Seoul" },
      result: "ok",
      isError: false,
      durationMs: 100,
    });

    const content = readFileSync(join(dir, "tools.jsonl"), "utf-8").trim();
    const record = JSON.parse(content);
    expect(record.args.apiKey).toBe("super-secret-key");
    expect(record.args.city).toBe("Seoul");
  });

  it("rotation triggers when file exceeds maxSizeMB", () => {
    const { logger, dir } = makeTempLogger({ maxSizeMB: 1 });

    // Write enough data to exceed 1MB
    const bigResult = "x".repeat(10_000);
    for (let i = 0; i < 120; i++) {
      logger.logTool({
        toolName: "big",
        args: {},
        result: bigResult,
        isError: false,
        durationMs: 1,
      });
    }

    // The rotated file should exist
    expect(existsSync(join(dir, "tools.1.jsonl"))).toBe(true);
    // The current file should still exist and be smaller than the rotated one
    const currentSize = statSync(join(dir, "tools.jsonl")).size;
    const rotatedSize = statSync(join(dir, "tools.1.jsonl")).size;
    expect(currentSize).toBeLessThan(rotatedSize);
  });

  it("rotation shifts files correctly (.1.jsonl → .2.jsonl)", () => {
    const { logger, dir } = makeTempLogger({ maxSizeMB: 1, maxFiles: 5 });

    // Write enough to trigger multiple rotations
    const bigResult = "x".repeat(10_000);
    for (let i = 0; i < 350; i++) {
      logger.logTool({
        toolName: "big",
        args: {},
        result: bigResult,
        isError: false,
        durationMs: 1,
      });
    }

    expect(existsSync(join(dir, "tools.1.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "tools.2.jsonl"))).toBe(true);
  });

  it("rotation respects maxFiles (oldest deleted)", () => {
    const { logger, dir } = makeTempLogger({ maxSizeMB: 1, maxFiles: 2 });

    // Write enough to exceed 2 rotations
    const bigResult = "x".repeat(10_000);
    for (let i = 0; i < 500; i++) {
      logger.logTool({
        toolName: "big",
        args: {},
        result: bigResult,
        isError: false,
        durationMs: 1,
      });
    }

    // Should have tools.jsonl, tools.1.jsonl, tools.2.jsonl at most
    expect(existsSync(join(dir, "tools.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "tools.1.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "tools.2.jsonl"))).toBe(true);
    // Should NOT have tools.3.jsonl (maxFiles=2, so .1 and .2 are the limit)
    expect(existsSync(join(dir, "tools.3.jsonl"))).toBe(false);
  });

  it("handles nested non-existent directory paths", () => {
    const baseDir = createTempDir();
    tempDirs.push(baseDir);
    const deepDir = join(baseDir, "a", "b", "c", "logs");

    const logger = new ActivityLogger({
      dir: deepDir,
      maxSizeMB: 10,
      maxFiles: 5,
    });

    expect(existsSync(deepDir)).toBe(true);

    logger.logTool({
      toolName: "test",
      args: {},
      result: "ok",
      isError: false,
      durationMs: 1,
    });

    const content = readFileSync(join(deepDir, "tools.jsonl"), "utf-8").trim();
    expect(JSON.parse(content).toolName).toBe("test");
  });
});

describe("noopActivityLogger", () => {
  it("methods don't throw", () => {
    expect(() => noopActivityLogger.logTool({
      toolName: "test",
      args: {},
      result: "ok",
      isError: false,
      durationMs: 1,
    })).not.toThrow();

    expect(() => noopActivityLogger.logProvider({
      sessionId: "s",
      model: "m",
      round: 1,
      finishReason: "stop",
      durationMs: 1,
      toolCallCount: 0,
    })).not.toThrow();

    expect(() => noopActivityLogger.logActivity({
      sessionId: "s",
      channel: "c",
      senderId: "u",
      messagePreview: "m",
      responsePreview: "r",
      toolsUsed: [],
      totalDurationMs: 1,
    })).not.toThrow();
  });
});
