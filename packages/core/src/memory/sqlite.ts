import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { MemoryEntry } from "./types.js";

export interface MemoryDatabase {
  readonly db: DatabaseSync;
  insert(entry: Omit<MemoryEntry, "id">): string;
  getById(id: string): MemoryEntry | undefined;
  deleteById(id: string): boolean;
  listAll(): MemoryEntry[];
  searchFts(query: string, limit: number): Array<{ id: string; rank: number }>;
  readonly ftsAvailable: boolean;
  close(): void;
}

export function createMemoryDatabase(dbPath: string): MemoryDatabase {
  const needsExtension = dbPath !== ":memory:";
  const db = new DatabaseSync(dbPath, {
    allowExtension: needsExtension,
  });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memory_entries_source ON memory_entries(source)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memory_entries_updated_at ON memory_entries(updated_at)",
  );

  let ftsAvailable = false;
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        id UNINDEXED,
        source UNINDEXED
      )
    `);
    ftsAvailable = true;
  } catch {
    // FTS5 not available in this SQLite build
  }

  const insertStmt = db.prepare(
    "INSERT INTO memory_entries (id, content, source, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertFtsStmt = ftsAvailable
    ? db.prepare("INSERT INTO memory_fts (content, id, source) VALUES (?, ?, ?)")
    : null;
  const getByIdStmt = db.prepare(
    "SELECT * FROM memory_entries WHERE id = ?",
  );
  const deleteStmt = db.prepare("DELETE FROM memory_entries WHERE id = ?");
  const deleteFtsStmt = ftsAvailable
    ? db.prepare("DELETE FROM memory_fts WHERE id = ?")
    : null;
  const listStmt = db.prepare(
    "SELECT * FROM memory_entries ORDER BY updated_at DESC",
  );
  const ftsSearchStmt = ftsAvailable
    ? db.prepare(
        "SELECT id, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?",
      )
    : null;

  return {
    db,
    ftsAvailable,

    insert(entry: Omit<MemoryEntry, "id">): string {
      const id = randomUUID();
      const metadataJson = JSON.stringify(entry.metadata);
      insertStmt.run(
        id,
        entry.content,
        entry.source,
        metadataJson,
        entry.createdAt,
        entry.updatedAt,
      );
      if (insertFtsStmt) {
        insertFtsStmt.run(entry.content, id, entry.source);
      }
      return id;
    },

    getById(id: string): MemoryEntry | undefined {
      const row = getByIdStmt.get(id) as
        | {
            id: string;
            content: string;
            source: string;
            metadata: string;
            created_at: number;
            updated_at: number;
          }
        | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        content: row.content,
        source: row.source,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    deleteById(id: string): boolean {
      const result = deleteStmt.run(id);
      if (deleteFtsStmt) {
        deleteFtsStmt.run(id);
      }
      return result.changes > 0;
    },

    listAll(): MemoryEntry[] {
      const rows = listStmt.all() as Array<{
        id: string;
        content: string;
        source: string;
        metadata: string;
        created_at: number;
        updated_at: number;
      }>;
      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        source: row.source,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    searchFts(
      query: string,
      limit: number,
    ): Array<{ id: string; rank: number }> {
      if (!ftsSearchStmt) return [];
      const ftsQuery = buildFtsQuery(query);
      if (!ftsQuery) return [];
      try {
        return ftsSearchStmt.all(ftsQuery, limit) as Array<{
          id: string;
          rank: number;
        }>;
      } catch {
        // Invalid FTS query syntax
        return [];
      }
    },

    close(): void {
      try {
        db.close();
      } catch {
        // Already closed
      }
    },
  };
}

function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((t) => t.trim())
    .filter(Boolean);
  if (!tokens || tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}
