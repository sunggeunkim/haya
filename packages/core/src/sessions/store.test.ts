import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "./store.js";
import type { Message } from "../agent/types.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `haya-sessions-test-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("SessionStore", () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tempDir = makeTempDir();
    store = new SessionStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a new session", () => {
    store.create("session-1", { title: "Test Session" });
    expect(store.exists("session-1")).toBe(true);
  });

  it("rejects duplicate session creation", () => {
    store.create("dup-1");
    expect(() => store.create("dup-1")).toThrow(/already exists/);
  });

  it("appends and reads messages", () => {
    store.create("msg-test");

    const msg1: Message = { role: "user", content: "Hello", timestamp: 1000 };
    const msg2: Message = {
      role: "assistant",
      content: "Hi there!",
      timestamp: 2000,
    };

    store.appendMessage("msg-test", msg1);
    store.appendMessage("msg-test", msg2);

    const messages = store.readMessages("msg-test");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Hello");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toBe("Hi there!");
  });

  it("throws when appending to nonexistent session", () => {
    expect(() =>
      store.appendMessage("nonexistent", {
        role: "user",
        content: "test",
      }),
    ).toThrow(/not found/);
  });

  it("reads entries including meta", () => {
    store.create("entries-test", { title: "My Chat" });
    store.appendMessage("entries-test", {
      role: "user",
      content: "Hello",
    });

    const entries = store.readEntries("entries-test");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.type).toBe("meta");
    expect(entries[1]?.type).toBe("message");
  });

  it("deletes a session", () => {
    store.create("delete-me");
    expect(store.delete("delete-me")).toBe(true);
    expect(store.exists("delete-me")).toBe(false);
  });

  it("returns false when deleting nonexistent session", () => {
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("lists all sessions", () => {
    store.create("list-1", { title: "First" });
    store.create("list-2", { title: "Second" });
    store.appendMessage("list-1", { role: "user", content: "msg" });

    const list = store.list();
    expect(list).toHaveLength(2);

    const first = list.find((s) => s.id === "list-1");
    expect(first?.title).toBe("First");
    expect(first?.messageCount).toBe(1);

    const second = list.find((s) => s.id === "list-2");
    expect(second?.title).toBe("Second");
    expect(second?.messageCount).toBe(0);
  });

  it("returns empty list when no sessions", () => {
    expect(store.list()).toEqual([]);
  });

  it("rejects path traversal in session IDs", () => {
    expect(() => store.create("../escape")).toThrow(/Invalid session ID/);
    expect(() => store.create("foo/bar")).toThrow(/Invalid session ID/);
    expect(() => store.create("")).toThrow(/Invalid session ID/);
    expect(() => store.create(".")).toThrow(/Invalid session ID/);
  });

  it("accepts valid session IDs", () => {
    store.create("valid-session_123");
    expect(store.exists("valid-session_123")).toBe(true);
  });
});
