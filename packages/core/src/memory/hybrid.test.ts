import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { hybridSearch, bm25RankToScore } from "./hybrid.js";
import { createMemoryDatabase, type MemoryDatabase } from "./sqlite.js";
import {
  loadSqliteVec,
  createVectorIndex,
  type VectorIndex,
} from "./sqlite-vec.js";

describe("bm25RankToScore", () => {
  it("returns 1.0 for negative rank (FTS match)", () => {
    // FTS5 rank is negative for matches
    expect(bm25RankToScore(-0.5)).toBe(1);
    expect(bm25RankToScore(-5)).toBe(1);
    expect(bm25RankToScore(-0.000002)).toBe(1);
  });

  it("returns 1.0 for rank 0 (boundary)", () => {
    expect(bm25RankToScore(0)).toBe(1);
  });

  it("returns decreasing scores for positive rank values", () => {
    const score1 = bm25RankToScore(1);
    const score10 = bm25RankToScore(10);
    expect(score1).toBeGreaterThan(score10);
    expect(score1).toBeLessThan(1);
  });

  it("handles NaN and Infinity gracefully", () => {
    const nanScore = bm25RankToScore(NaN);
    expect(Number.isFinite(nanScore)).toBe(true);

    const infScore = bm25RankToScore(Infinity);
    expect(Number.isFinite(infScore)).toBe(true);
  });

  it("returns values between 0 and 1", () => {
    for (const rank of [-100, -10, -1, 0, 1, 10, 100]) {
      const score = bm25RankToScore(rank);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("hybridSearch", () => {
  let memoryDb: MemoryDatabase;
  let vectorIndex: VectorIndex | null = null;
  let db: DatabaseSync;

  beforeEach(async () => {
    memoryDb = createMemoryDatabase(":memory:");

    // Set up vector index
    db = memoryDb.db;
    // For in-memory databases, we need a new db with allowExtension
    // Since createMemoryDatabase uses :memory: without allowExtension,
    // we'll test FTS-only and vector separately
  });

  afterEach(() => {
    memoryDb.close();
  });

  it("returns empty results when no entries exist", () => {
    const results = hybridSearch({
      query: "test",
      queryEmbedding: null,
      memoryDb,
      vectorIndex: null,
    });
    expect(results).toEqual([]);
  });

  it("searches using FTS only when no vector index", () => {
    const now = Date.now();
    memoryDb.insert({
      content: "TypeScript is a typed superset of JavaScript",
      source: "docs",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    memoryDb.insert({
      content: "Python is a popular programming language",
      source: "docs",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    const results = hybridSearch({
      query: "TypeScript JavaScript",
      queryEmbedding: null,
      memoryDb,
      vectorIndex: null,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("TypeScript");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("respects the limit option", () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      memoryDb.insert({
        content: `Document about testing number ${i}`,
        source: "test",
        metadata: {},
        createdAt: now + i,
        updatedAt: now + i,
      });
    }

    const results = hybridSearch({
      query: "testing",
      queryEmbedding: null,
      memoryDb,
      vectorIndex: null,
      options: { limit: 5 },
    });

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("filters results below minScore", () => {
    const now = Date.now();
    memoryDb.insert({
      content: "Something completely unrelated to the query",
      source: "test",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    const results = hybridSearch({
      query: "quantum physics relativity",
      queryEmbedding: null,
      memoryDb,
      vectorIndex: null,
      options: { minScore: 0.9 },
    });

    // All results should be above minScore
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("includes metadata in results", () => {
    const now = Date.now();
    memoryDb.insert({
      content: "Document with rich metadata for searching",
      source: "test-source",
      metadata: { tags: ["important"], priority: 1 },
      createdAt: now,
      updatedAt: now,
    });

    const results = hybridSearch({
      query: "metadata searching",
      queryEmbedding: null,
      memoryDb,
      vectorIndex: null,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].metadata).toEqual({ tags: ["important"], priority: 1 });
    expect(results[0].source).toBe("test-source");
  });

  it("normalizes weights when they don't sum to 1", () => {
    const now = Date.now();
    memoryDb.insert({
      content: "Normalized weight test document",
      source: "test",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    // Weights that don't sum to 1
    const results = hybridSearch({
      query: "weight test",
      queryEmbedding: null,
      memoryDb,
      vectorIndex: null,
      options: { vectorWeight: 3, textWeight: 7 },
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // Score should still be between 0 and 1
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].score).toBeLessThanOrEqual(1);
  });
});

describe("hybridSearch with vector index", () => {
  let db: DatabaseSync;
  let memoryDb: MemoryDatabase;
  let vectorIndex: VectorIndex;

  beforeEach(async () => {
    // Create a database with extension support for vector search
    db = new DatabaseSync(":memory:", { allowExtension: true });
    const vecResult = await loadSqliteVec(db);
    if (!vecResult.ok) {
      throw new Error(`sqlite-vec not available: ${vecResult.error}`);
    }

    // Create the tables manually since we need allowExtension
    db.exec("PRAGMA journal_mode = WAL");
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
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        id UNINDEXED,
        source UNINDEXED
      )
    `);

    // Use the raw db but wrap it with the MemoryDatabase interface for hybrid search
    memoryDb = createMemoryDatabaseFromExisting(db);
    vectorIndex = createVectorIndex(db, 4);
  });

  afterEach(() => {
    db.close();
  });

  it("combines vector and FTS scores", () => {
    const now = Date.now();

    // Insert entries
    const id1 = insertEntry(db, {
      content: "TypeScript programming language guide",
      source: "docs",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    const id2 = insertEntry(db, {
      content: "Python machine learning tutorial",
      source: "docs",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    // Insert vectors - id1 is closer to query vector
    vectorIndex.insert(id1, [0.9, 0.1, 0, 0]);
    vectorIndex.insert(id2, [0.1, 0.9, 0, 0]);

    const results = hybridSearch({
      query: "TypeScript programming",
      queryEmbedding: [1, 0, 0, 0],
      memoryDb,
      vectorIndex,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // id1 should score higher (closer vector + keyword match)
    expect(results[0].id).toBe(id1);
  });

  it("uses vector-only when FTS has no matches", () => {
    const now = Date.now();

    const id1 = insertEntry(db, {
      content: "Alpha beta gamma",
      source: "test",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    const id2 = insertEntry(db, {
      content: "Delta epsilon zeta",
      source: "test",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    vectorIndex.insert(id1, [1, 0, 0, 0]);
    vectorIndex.insert(id2, [0, 1, 0, 0]);

    // Query that won't match FTS but will match via vector
    const results = hybridSearch({
      query: "nonexistent keyword",
      queryEmbedding: [1, 0, 0, 0],
      memoryDb,
      vectorIndex,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(id1);
  });
});

// Helper to insert into the raw db tables
function insertEntry(
  db: DatabaseSync,
  entry: {
    content: string;
    source: string;
    metadata: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
  },
): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO memory_entries (id, content, source, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, entry.content, entry.source, JSON.stringify(entry.metadata), entry.createdAt, entry.updatedAt);
  db.prepare(
    "INSERT INTO memory_fts (content, id, source) VALUES (?, ?, ?)",
  ).run(entry.content, id, entry.source);
  return id;
}

// Wraps an existing DatabaseSync as a MemoryDatabase for hybrid search
function createMemoryDatabaseFromExisting(db: DatabaseSync): MemoryDatabase {
  const getByIdStmt = db.prepare("SELECT * FROM memory_entries WHERE id = ?");
  const ftsSearchStmt = db.prepare(
    "SELECT id, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?",
  );

  function buildFtsQuery(raw: string): string | null {
    const tokens = raw
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => t.trim())
      .filter(Boolean);
    if (!tokens || tokens.length === 0) return null;
    const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
    return quoted.join(" AND ");
  }

  return {
    db,
    ftsAvailable: true,
    insert: () => { throw new Error("Not implemented"); },
    getById(id: string) {
      const row = getByIdStmt.get(id) as {
        id: string;
        content: string;
        source: string;
        metadata: string;
        created_at: number;
        updated_at: number;
      } | undefined;
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
    deleteById: () => false,
    listAll: () => [],
    searchFts(query: string, limit: number) {
      const ftsQuery = buildFtsQuery(query);
      if (!ftsQuery) return [];
      try {
        return ftsSearchStmt.all(ftsQuery, limit) as Array<{ id: string; rank: number }>;
      } catch {
        return [];
      }
    },
    close: () => {},
  };
}
