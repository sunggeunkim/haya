import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryDatabase, type MemoryDatabase } from "./sqlite.js";

describe("createMemoryDatabase", () => {
  let db: MemoryDatabase;

  beforeEach(() => {
    db = createMemoryDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates an in-memory database", () => {
    expect(db).toBeDefined();
    expect(db.db).toBeDefined();
  });

  it("inserts and retrieves an entry", () => {
    const now = Date.now();
    const id = db.insert({
      content: "Hello world",
      source: "test",
      metadata: { key: "value" },
      createdAt: now,
      updatedAt: now,
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe("string");

    const entry = db.getById(id);
    expect(entry).toBeDefined();
    expect(entry!.content).toBe("Hello world");
    expect(entry!.source).toBe("test");
    expect(entry!.metadata).toEqual({ key: "value" });
    expect(entry!.createdAt).toBe(now);
    expect(entry!.updatedAt).toBe(now);
  });

  it("returns undefined for non-existent entry", () => {
    const entry = db.getById("non-existent-id");
    expect(entry).toBeUndefined();
  });

  it("deletes an entry", () => {
    const now = Date.now();
    const id = db.insert({
      content: "To be deleted",
      source: "test",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    expect(db.getById(id)).toBeDefined();
    const deleted = db.deleteById(id);
    expect(deleted).toBe(true);
    expect(db.getById(id)).toBeUndefined();
  });

  it("returns false when deleting non-existent entry", () => {
    const deleted = db.deleteById("non-existent-id");
    expect(deleted).toBe(false);
  });

  it("lists all entries ordered by updated_at descending", () => {
    const now = Date.now();
    db.insert({
      content: "First",
      source: "test",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    db.insert({
      content: "Second",
      source: "test",
      metadata: {},
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    db.insert({
      content: "Third",
      source: "test",
      metadata: {},
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    const entries = db.listAll();
    expect(entries).toHaveLength(3);
    expect(entries[0].content).toBe("Third");
    expect(entries[1].content).toBe("Second");
    expect(entries[2].content).toBe("First");
  });

  it("generates unique IDs", () => {
    const now = Date.now();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = db.insert({
        content: `Entry ${i}`,
        source: "test",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
      ids.add(id);
    }
    expect(ids.size).toBe(100);
  });

  describe("FTS5 full-text search", () => {
    it("reports FTS as available", () => {
      expect(db.ftsAvailable).toBe(true);
    });

    it("finds entries by keyword", () => {
      const now = Date.now();
      const id1 = db.insert({
        content: "The quick brown fox jumps over the lazy dog",
        source: "test",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
      db.insert({
        content: "A completely different sentence about programming",
        source: "test",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      const results = db.searchFts("quick fox", 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe(id1);
    });

    it("returns empty array for no matches", () => {
      const now = Date.now();
      db.insert({
        content: "Hello world",
        source: "test",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      const results = db.searchFts("zyxwvut", 10);
      expect(results).toHaveLength(0);
    });

    it("returns empty array for empty query", () => {
      const results = db.searchFts("", 10);
      expect(results).toHaveLength(0);
    });

    it("returns empty array for query with only special characters", () => {
      const results = db.searchFts("!@#$%^&*()", 10);
      expect(results).toHaveLength(0);
    });

    it("respects the limit parameter", () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        db.insert({
          content: `Test document number ${i} with searchable keywords`,
          source: "test",
          metadata: {},
          createdAt: now + i,
          updatedAt: now + i,
        });
      }

      const results = db.searchFts("searchable keywords", 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("removes FTS entry when entry is deleted", () => {
      const now = Date.now();
      const id = db.insert({
        content: "Unique searchable content for deletion test",
        source: "test",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      let results = db.searchFts("deletion", 10);
      expect(results.length).toBeGreaterThanOrEqual(1);

      db.deleteById(id);

      results = db.searchFts("deletion", 10);
      expect(results).toHaveLength(0);
    });
  });

  describe("metadata handling", () => {
    it("stores and retrieves complex metadata", () => {
      const now = Date.now();
      const metadata = {
        tags: ["important", "test"],
        priority: 5,
        nested: { key: "value" },
      };
      const id = db.insert({
        content: "With metadata",
        source: "test",
        metadata,
        createdAt: now,
        updatedAt: now,
      });

      const entry = db.getById(id);
      expect(entry!.metadata).toEqual(metadata);
    });

    it("handles empty metadata", () => {
      const now = Date.now();
      const id = db.insert({
        content: "No metadata",
        source: "test",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      const entry = db.getById(id);
      expect(entry!.metadata).toEqual({});
    });
  });
});
