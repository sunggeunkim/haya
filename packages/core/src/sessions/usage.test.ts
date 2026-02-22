import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageTracker } from "./usage.js";
import type { TokenUsage } from "../agent/types.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `haya-usage-test-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("UsageTracker", () => {
  let tempDir: string;
  let tracker: UsageTracker;

  beforeEach(() => {
    tempDir = makeTempDir();
    tracker = new UsageTracker(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts with empty usage", () => {
    const total = tracker.getTotalUsage();
    expect(total.totalTokens).toBe(0);
    expect(total.promptTokens).toBe(0);
    expect(total.completionTokens).toBe(0);
    expect(total.requestCount).toBe(0);
  });

  it("records and retrieves usage", () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };

    tracker.record("session-1", "gpt-4o", usage);

    const total = tracker.getTotalUsage();
    expect(total.totalTokens).toBe(150);
    expect(total.promptTokens).toBe(100);
    expect(total.completionTokens).toBe(50);
    expect(total.requestCount).toBe(1);
  });

  it("accumulates multiple records", () => {
    tracker.record("session-1", "gpt-4o", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    tracker.record("session-1", "gpt-4o", {
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    });

    const total = tracker.getTotalUsage();
    expect(total.totalTokens).toBe(450);
    expect(total.requestCount).toBe(2);
  });

  it("filters by session ID", () => {
    tracker.record("session-a", "gpt-4o", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    tracker.record("session-b", "gpt-4o", {
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    });

    const sessionA = tracker.getSessionUsage("session-a");
    expect(sessionA.totalTokens).toBe(150);
    expect(sessionA.records).toHaveLength(1);

    const sessionB = tracker.getSessionUsage("session-b");
    expect(sessionB.totalTokens).toBe(300);
    expect(sessionB.records).toHaveLength(1);
  });

  it("returns empty for unknown session", () => {
    const result = tracker.getSessionUsage("nonexistent");
    expect(result.totalTokens).toBe(0);
    expect(result.records).toHaveLength(0);
  });

  it("groups usage by model", () => {
    tracker.record("session-1", "gpt-4o", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    tracker.record("session-1", "gpt-4o-mini", {
      promptTokens: 50,
      completionTokens: 25,
      totalTokens: 75,
    });
    tracker.record("session-2", "gpt-4o", {
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    });

    const byModel = tracker.getUsageByModel();
    expect(byModel.size).toBe(2);

    const gpt4o = byModel.get("gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.totalTokens).toBe(450);
    expect(gpt4o!.requestCount).toBe(2);

    const mini = byModel.get("gpt-4o-mini");
    expect(mini).toBeDefined();
    expect(mini!.totalTokens).toBe(75);
    expect(mini!.requestCount).toBe(1);
  });

  it("filters total usage by timestamp", () => {
    tracker.record("session-1", "gpt-4o", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    // Query with a future timestamp should return nothing
    const futureResult = tracker.getTotalUsage(Date.now() + 10000);
    expect(futureResult.requestCount).toBe(0);

    // Query with a past timestamp should include all records
    const pastResult = tracker.getTotalUsage(Date.now() - 10000);
    expect(pastResult.requestCount).toBe(1);
  });

  it("creates data directory if it does not exist", () => {
    const newDir = join(tempDir, "nested", "dir");
    const newTracker = new UsageTracker(newDir);

    // Should not throw, directory is created
    newTracker.record("session-1", "gpt-4o", {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });

    const total = newTracker.getTotalUsage();
    expect(total.totalTokens).toBe(15);
  });

  it("persists data across tracker instances", () => {
    tracker.record("session-1", "gpt-4o", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    // Create a new tracker instance pointing to the same directory
    const tracker2 = new UsageTracker(tempDir);
    const total = tracker2.getTotalUsage();
    expect(total.totalTokens).toBe(150);
    expect(total.requestCount).toBe(1);
  });
});
