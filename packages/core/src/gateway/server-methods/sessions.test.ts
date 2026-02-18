import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../../sessions/store.js";
import {
  createSessionsCreateHandler,
  createSessionsDeleteHandler,
  createSessionsHistoryHandler,
  createSessionsListHandler,
} from "./sessions.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `haya-methods-test-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("sessions server methods", () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tempDir = makeTempDir();
    store = new SessionStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("sessions.list", () => {
    it("returns empty list initially", async () => {
      const handler = createSessionsListHandler(store);
      const result = (await handler(undefined, "client-1")) as {
        sessions: unknown[];
      };
      expect(result.sessions).toEqual([]);
    });

    it("returns existing sessions", async () => {
      store.create("s1", { title: "Test" });
      const handler = createSessionsListHandler(store);
      const result = (await handler(undefined, "client-1")) as {
        sessions: unknown[];
      };
      expect(result.sessions).toHaveLength(1);
    });
  });

  describe("sessions.create", () => {
    it("creates a new session", async () => {
      const handler = createSessionsCreateHandler(store);
      const result = (await handler(
        { title: "New Chat" },
        "client-1",
      )) as { sessionId: string };
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId.length).toBeGreaterThan(0);
      expect(store.exists(result.sessionId)).toBe(true);
    });

    it("creates a session with no params", async () => {
      const handler = createSessionsCreateHandler(store);
      const result = (await handler(undefined, "client-1")) as {
        sessionId: string;
      };
      expect(result.sessionId).toBeDefined();
    });
  });

  describe("sessions.delete", () => {
    it("deletes an existing session", async () => {
      store.create("to-delete");
      const handler = createSessionsDeleteHandler(store);
      const result = (await handler(
        { sessionId: "to-delete" },
        "client-1",
      )) as { deleted: boolean };
      expect(result.deleted).toBe(true);
      expect(store.exists("to-delete")).toBe(false);
    });

    it("returns false for nonexistent session", async () => {
      const handler = createSessionsDeleteHandler(store);
      const result = (await handler(
        { sessionId: "nonexistent" },
        "client-1",
      )) as { deleted: boolean };
      expect(result.deleted).toBe(false);
    });
  });

  describe("sessions.history", () => {
    it("returns messages for a session", async () => {
      store.create("history-test");
      store.appendMessage("history-test", {
        role: "user",
        content: "Hello",
      });
      store.appendMessage("history-test", {
        role: "assistant",
        content: "Hi!",
      });

      const handler = createSessionsHistoryHandler(store);
      const result = (await handler(
        { sessionId: "history-test" },
        "client-1",
      )) as { messages: unknown[] };
      expect(result.messages).toHaveLength(2);
    });

    it("respects limit parameter", async () => {
      store.create("limit-test");
      for (let i = 0; i < 5; i++) {
        store.appendMessage("limit-test", {
          role: "user",
          content: `msg ${i}`,
        });
      }

      const handler = createSessionsHistoryHandler(store);
      const result = (await handler(
        { sessionId: "limit-test", limit: 2 },
        "client-1",
      )) as { messages: unknown[] };
      expect(result.messages).toHaveLength(2);
    });
  });
});
