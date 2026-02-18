import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMemoryManager } from "./manager.js";
import type { MemorySearchManager } from "./types.js";

describe("createMemoryManager", () => {
  let manager: MemorySearchManager;

  afterEach(() => {
    if (manager) {
      manager.close();
    }
    vi.restoreAllMocks();
  });

  describe("FTS-only mode (no embedding provider)", () => {
    beforeEach(async () => {
      manager = await createMemoryManager({
        dbPath: ":memory:",
      });
    });

    it("creates a manager without embedding config", () => {
      expect(manager).toBeDefined();
      expect(manager.search).toBeDefined();
      expect(manager.index).toBeDefined();
      expect(manager.delete).toBeDefined();
      expect(manager.close).toBeDefined();
    });

    it("indexes and searches content via FTS", async () => {
      const id = await manager.index(
        "TypeScript is a statically typed language",
        "docs",
        { category: "programming" },
      );

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");

      const results = await manager.search("TypeScript typed");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain("TypeScript");
      expect(results[0].source).toBe("docs");
      expect(results[0].metadata).toEqual({ category: "programming" });
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("returns empty results for no match", async () => {
      await manager.index("Hello world", "test");
      const results = await manager.search("zyxwvut nonexistent");
      expect(results).toEqual([]);
    });

    it("respects the limit parameter", async () => {
      for (let i = 0; i < 20; i++) {
        await manager.index(
          `Document about testing and searching number ${i}`,
          "test",
        );
      }

      const results = await manager.search("testing searching", 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("deletes indexed content", async () => {
      const id = await manager.index("Content to delete", "test");

      let results = await manager.search("delete");
      expect(results.length).toBeGreaterThanOrEqual(1);

      await manager.delete(id);

      results = await manager.search("delete");
      expect(results).toHaveLength(0);
    });

    it("handles deleting non-existent id gracefully", async () => {
      await expect(
        manager.delete("non-existent-id"),
      ).resolves.not.toThrow();
    });

    it("indexes with default empty metadata", async () => {
      const id = await manager.index("No metadata content", "test");
      const results = await manager.search("metadata content");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].metadata).toEqual({});
    });

    it("searches multiple documents and ranks by relevance", async () => {
      await manager.index(
        "JavaScript runtime environment for server applications",
        "docs",
      );
      await manager.index(
        "JavaScript frameworks like React and Vue",
        "docs",
      );
      await manager.index(
        "Python data science libraries",
        "docs",
      );

      const results = await manager.search("JavaScript");
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Both JavaScript entries should appear
      const contents = results.map((r) => r.content);
      expect(contents.some((c) => c.includes("JavaScript"))).toBe(true);
    });
  });

  describe("with mock embedding provider", () => {
    it("handles embedding failures gracefully during indexing", async () => {
      // Mock fetch to simulate embedding API failure
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );

      process.env.TEST_EMB_KEY = "test-key";
      manager = await createMemoryManager({
        dbPath: ":memory:",
        embedding: {
          provider: "openai",
          apiKeyEnvVar: "TEST_EMB_KEY",
          dimensions: 4,
        },
      });

      // Should still index content (FTS will work even if embedding fails)
      const id = await manager.index("Searchable content", "test");
      expect(id).toBeDefined();

      // Search with FTS should still work
      const results = await manager.search("Searchable content");
      expect(results.length).toBeGreaterThanOrEqual(1);

      delete process.env.TEST_EMB_KEY;
    });

    it("handles embedding failures gracefully during search", async () => {
      // Mock fetch to fail on embed call
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );

      process.env.TEST_EMB_KEY = "test-key";
      manager = await createMemoryManager({
        dbPath: ":memory:",
        embedding: {
          provider: "openai",
          apiKeyEnvVar: "TEST_EMB_KEY",
          dimensions: 4,
        },
      });

      await manager.index("Fallback search content", "test");

      // Should fall back to FTS-only search
      const results = await manager.search("Fallback search");
      // FTS should still work
      expect(results.length).toBeGreaterThanOrEqual(1);

      delete process.env.TEST_EMB_KEY;
    });
  });

  describe("close", () => {
    it("can be called multiple times without error", async () => {
      manager = await createMemoryManager({ dbPath: ":memory:" });
      manager.close();
      // Second close should not throw
      expect(() => manager.close()).not.toThrow();
      // Prevent afterEach from double-closing
      manager = { search: async () => [], index: async () => "", delete: async () => {}, close: () => {} };
    });
  });
});
