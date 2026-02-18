import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Message } from "../agent/types.js";
import type { SessionEntry, SessionListItem, SessionMeta } from "./types.js";

/**
 * Session store using JSONL (JSON Lines) persistence.
 * Each session is stored as a separate .jsonl file.
 * Each line is a JSON object representing a message or metadata entry.
 */

export class SessionStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Create a new session. Returns the session ID.
   */
  create(sessionId: string, meta?: { title?: string; model?: string }): void {
    const filePath = this.sessionPath(sessionId);
    if (existsSync(filePath)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }

    const entry: SessionEntry = {
      type: "meta",
      timestamp: Date.now(),
      data: {
        title: meta?.title,
        model: meta?.model,
        createdAt: Date.now(),
      },
    };

    writeFileSync(filePath, JSON.stringify(entry) + "\n", {
      mode: 0o600,
    });
  }

  /**
   * Append a message to a session.
   */
  appendMessage(sessionId: string, message: Message): void {
    const filePath = this.sessionPath(sessionId);
    if (!existsSync(filePath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const entry: SessionEntry = {
      type: "message",
      timestamp: message.timestamp ?? Date.now(),
      data: message,
    };

    appendFileSync(filePath, JSON.stringify(entry) + "\n");
  }

  /**
   * Read all entries from a session file.
   */
  readEntries(sessionId: string): SessionEntry[] {
    const filePath = this.sessionPath(sessionId);
    if (!existsSync(filePath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as SessionEntry;
      } catch {
        throw new Error(
          `Corrupt session file ${sessionId}, line ${index + 1}`,
        );
      }
    });
  }

  /**
   * Read only message entries from a session.
   */
  readMessages(sessionId: string): Message[] {
    const entries = this.readEntries(sessionId);
    return entries
      .filter((e) => e.type === "message")
      .map((e) => e.data as Message);
  }

  /**
   * Check if a session exists.
   */
  exists(sessionId: string): boolean {
    return existsSync(this.sessionPath(sessionId));
  }

  /**
   * Delete a session.
   */
  delete(sessionId: string): boolean {
    const filePath = this.sessionPath(sessionId);
    if (!existsSync(filePath)) return false;
    rmSync(filePath);
    return true;
  }

  /**
   * List all sessions with summary info.
   */
  list(): SessionListItem[] {
    if (!existsSync(this.baseDir)) return [];

    const files = readdirSync(this.baseDir).filter((f) =>
      f.endsWith(".jsonl"),
    );

    return files.map((file) => {
      const sessionId = file.replace(/\.jsonl$/, "");
      const entries = this.readEntries(sessionId);
      const meta = entries.find((e) => e.type === "meta");
      const messages = entries.filter((e) => e.type === "message");
      const metaData = meta?.data as SessionMeta | undefined;

      const timestamps = entries.map((e) => e.timestamp);
      const createdAt = metaData?.createdAt ?? Math.min(...timestamps);
      const updatedAt =
        timestamps.length > 0 ? Math.max(...timestamps) : createdAt;

      return {
        id: sessionId,
        title: metaData?.title,
        createdAt,
        updatedAt,
        messageCount: messages.length,
      };
    });
  }

  private sessionPath(sessionId: string): string {
    // Prevent path traversal
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (safe !== sessionId || safe.length === 0) {
      throw new Error(`Invalid session ID: ${sessionId}`);
    }
    return join(this.baseDir, `${safe}.jsonl`);
  }
}
