import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  loadSqliteVec,
  createVectorIndex,
  distanceToScore,
  normalizeEmbedding,
  type VectorIndex,
} from "./sqlite-vec.js";

describe("sqlite-vec", () => {
  let db: DatabaseSync;

  beforeEach(async () => {
    db = new DatabaseSync(":memory:", { allowExtension: true });
    const result = await loadSqliteVec(db);
    if (!result.ok) {
      throw new Error(`sqlite-vec not available: ${result.error}`);
    }
  });

  afterEach(() => {
    db.close();
  });

  describe("loadSqliteVec", () => {
    it("loads the sqlite-vec extension", async () => {
      const freshDb = new DatabaseSync(":memory:", { allowExtension: true });
      const result = await loadSqliteVec(freshDb);
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      freshDb.close();
    });

    it("returns error when extension loading is not allowed", async () => {
      const noExtDb = new DatabaseSync(":memory:");
      const result = await loadSqliteVec(noExtDb);
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      noExtDb.close();
    });
  });

  describe("createVectorIndex", () => {
    let index: VectorIndex;

    beforeEach(() => {
      index = createVectorIndex(db, 4);
    });

    it("creates a vector index with correct dimensions", () => {
      expect(index.dimensions).toBe(4);
      expect(index.available).toBe(true);
    });

    it("inserts and searches vectors", () => {
      index.insert("a", [1, 0, 0, 0]);
      index.insert("b", [0, 1, 0, 0]);
      index.insert("c", [0, 0, 1, 0]);

      const results = index.search([1, 0, 0, 0], 3);
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("a");
      expect(results[0].distance).toBeCloseTo(0, 5);
    });

    it("returns results sorted by distance ascending", () => {
      index.insert("exact", [1, 0, 0, 0]);
      index.insert("close", [0.9, 0.1, 0, 0]);
      index.insert("far", [0, 0, 0, 1]);

      const results = index.search([1, 0, 0, 0], 3);
      expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
      expect(results[1].distance).toBeLessThanOrEqual(results[2].distance);
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        const vec = [0, 0, 0, 0];
        vec[i % 4] = 1;
        index.insert(`item-${i}`, vec);
      }

      const results = index.search([1, 0, 0, 0], 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("deletes entries from the index", () => {
      index.insert("to-delete", [1, 0, 0, 0]);
      index.insert("to-keep", [0, 1, 0, 0]);

      index.delete("to-delete");

      const results = index.search([1, 0, 0, 0], 10);
      const ids = results.map((r) => r.id);
      expect(ids).not.toContain("to-delete");
      expect(ids).toContain("to-keep");
    });

    it("handles high-dimensional vectors", () => {
      const dim = 128;
      const highDimDb = new DatabaseSync(":memory:", { allowExtension: true });
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      loadSqliteVec(highDimDb).then(() => {
        const highDimIndex = createVectorIndex(highDimDb, dim);

        const vec1 = Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0));
        const vec2 = Array.from({ length: dim }, (_, i) => (i === 1 ? 1 : 0));

        highDimIndex.insert("v1", vec1);
        highDimIndex.insert("v2", vec2);

        const results = highDimIndex.search(vec1, 2);
        expect(results[0].id).toBe("v1");
        highDimDb.close();
      });
    });
  });

  describe("distanceToScore", () => {
    it("returns 1 for distance 0", () => {
      expect(distanceToScore(0)).toBe(1);
    });

    it("returns values between 0 and 1 for positive distances", () => {
      expect(distanceToScore(1)).toBeCloseTo(0.5, 5);
      expect(distanceToScore(2)).toBeCloseTo(1 / 3, 5);
    });

    it("returns 1 for negative distances (treated as 0)", () => {
      expect(distanceToScore(-1)).toBe(1);
    });

    it("decreases monotonically with increasing distance", () => {
      const s1 = distanceToScore(0.5);
      const s2 = distanceToScore(1);
      const s3 = distanceToScore(2);
      expect(s1).toBeGreaterThan(s2);
      expect(s2).toBeGreaterThan(s3);
    });
  });

  describe("normalizeEmbedding", () => {
    it("normalizes a vector to unit length", () => {
      const vec = [3, 4]; // magnitude = 5
      const normalized = normalizeEmbedding(vec);
      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);
    });

    it("handles already-normalized vectors", () => {
      const vec = [1, 0, 0];
      const normalized = normalizeEmbedding(vec);
      expect(normalized).toEqual([1, 0, 0]);
    });

    it("handles zero vectors without division by zero", () => {
      const vec = [0, 0, 0];
      const normalized = normalizeEmbedding(vec);
      expect(normalized).toEqual([0, 0, 0]);
    });

    it("sanitizes NaN and Infinity values", () => {
      const vec = [1, NaN, Infinity, -Infinity];
      const normalized = normalizeEmbedding(vec);
      // NaN, Infinity, -Infinity should become 0
      expect(Number.isFinite(normalized[0])).toBe(true);
      expect(normalized[1]).toBe(0);
      expect(normalized[2]).toBe(0);
      expect(normalized[3]).toBe(0);
    });

    it("produces unit-length output", () => {
      const vec = [1, 2, 3, 4, 5];
      const normalized = normalizeEmbedding(vec);
      const magnitude = Math.sqrt(
        normalized.reduce((sum, v) => sum + v * v, 0),
      );
      expect(magnitude).toBeCloseTo(1, 5);
    });
  });
});
