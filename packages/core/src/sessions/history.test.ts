import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryManager } from "./history.js";
import { SessionStore } from "./store.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `haya-history-test-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("HistoryManager", () => {
  let tempDir: string;
  let store: SessionStore;
  let history: HistoryManager;

  beforeEach(() => {
    tempDir = makeTempDir();
    store = new SessionStore(tempDir);
    history = new HistoryManager(store, 5);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty history for nonexistent session", () => {
    expect(history.getHistory("nonexistent")).toEqual([]);
  });

  it("adds and retrieves messages", () => {
    history.addMessage("s1", { role: "user", content: "Hello" });
    history.addMessage("s1", { role: "assistant", content: "Hi!" });

    const messages = history.getHistory("s1");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe("Hello");
    expect(messages[1]?.content).toBe("Hi!");
  });

  it("creates session automatically on first message", () => {
    history.addMessage("auto-create", { role: "user", content: "test" });
    expect(store.exists("auto-create")).toBe(true);
  });

  it("truncates history to maxMessages (keeps most recent)", () => {
    for (let i = 1; i <= 8; i++) {
      history.addMessage("truncate-test", {
        role: "user",
        content: `Message ${i}`,
      });
    }

    const messages = history.getHistory("truncate-test");
    expect(messages).toHaveLength(5);
    expect(messages[0]?.content).toBe("Message 4");
    expect(messages[4]?.content).toBe("Message 8");
  });

  it("returns all messages when under limit", () => {
    history.addMessage("under-limit", { role: "user", content: "A" });
    history.addMessage("under-limit", { role: "assistant", content: "B" });

    const messages = history.getHistory("under-limit");
    expect(messages).toHaveLength(2);
  });

  it("adds multiple messages at once", () => {
    history.addMessages("batch", [
      { role: "user", content: "Q" },
      { role: "assistant", content: "A" },
    ]);

    const messages = history.getHistory("batch");
    expect(messages).toHaveLength(2);
  });

  it("reports correct message count", () => {
    expect(history.getMessageCount("no-session")).toBe(0);

    history.addMessage("count-test", { role: "user", content: "1" });
    history.addMessage("count-test", { role: "assistant", content: "2" });
    expect(history.getMessageCount("count-test")).toBe(2);
  });
});
