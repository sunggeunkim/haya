import { mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "./store.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `haya-prune-test-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("SessionStore.prune", () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tempDir = makeTempDir();
    store = new SessionStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns zero counts when no sessions exist", () => {
    const result = store.prune({ maxAgeDays: 30 });
    expect(result.deletedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
  });

  it("prunes sessions older than maxAgeDays", () => {
    // Create two sessions
    store.create("old-session");
    store.create("new-session");

    // Make the old session file appear old by changing its mtime
    const oldPath = join(tempDir, "old-session.jsonl");
    const pastDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    utimesSync(oldPath, pastDate, pastDate);

    const result = store.prune({ maxAgeDays: 30 });
    expect(result.deletedCount).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(store.exists("old-session")).toBe(false);
    expect(store.exists("new-session")).toBe(true);
  });

  it("does not prune recent sessions", () => {
    store.create("recent-session");

    const result = store.prune({ maxAgeDays: 30 });
    expect(result.deletedCount).toBe(0);
    expect(store.exists("recent-session")).toBe(true);
  });

  it("prunes by size, removing oldest first", () => {
    // Create sessions with known content sizes
    store.create("size-a");
    store.appendMessage("size-a", { role: "user", content: "A".repeat(2000) });
    const pathA = join(tempDir, "size-a.jsonl");
    const oldDate = new Date(Date.now() - 10000);
    utimesSync(pathA, oldDate, oldDate);

    store.create("size-b");
    store.appendMessage("size-b", { role: "user", content: "B".repeat(2000) });

    // Each file is ~2KB. Set max to ~3KB so one must be pruned.
    const result = store.prune({ maxSizeMB: 3 / 1024 });
    expect(result.deletedCount).toBe(1);
    // The oldest session (size-a) should be removed first, size-b should remain
    expect(store.exists("size-a")).toBe(false);
    expect(store.exists("size-b")).toBe(true);
  });

  it("handles combined age and size pruning", () => {
    store.create("combo-old");
    const oldPath = join(tempDir, "combo-old.jsonl");
    const pastDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    utimesSync(oldPath, pastDate, pastDate);

    store.create("combo-new");

    const result = store.prune({ maxAgeDays: 30, maxSizeMB: 100 });
    // Age-based pruning should remove the old one
    expect(result.deletedCount).toBe(1);
    expect(store.exists("combo-old")).toBe(false);
    expect(store.exists("combo-new")).toBe(true);
  });

  it("handles empty baseDir gracefully", () => {
    const emptyDir = makeTempDir();
    rmSync(emptyDir, { recursive: true, force: true });
    const emptyStore = new SessionStore(emptyDir);

    const result = emptyStore.prune({ maxAgeDays: 7 });
    expect(result.deletedCount).toBe(0);

    rmSync(emptyDir, { recursive: true, force: true });
  });
});
