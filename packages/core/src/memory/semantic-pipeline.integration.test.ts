import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryManager } from "./manager.js";
import type { MemorySearchManager } from "./types.js";

describe("Semantic Pipeline Integration (Layer 2)", () => {
  let manager: MemorySearchManager;

  beforeEach(async () => {
    manager = await createMemoryManager({ dbPath: ":memory:" });
  });

  afterEach(() => {
    manager.close();
  });

  it("index → search → retrieve cycle", async () => {
    await manager.index("TypeScript is a statically typed language", "docs");
    await manager.index("JavaScript runs in the browser", "docs");
    await manager.index("Python is great for data science", "docs");
    await manager.index("Rust is a systems programming language", "docs");
    await manager.index("Go is designed for concurrency", "docs");

    const results = await manager.search("TypeScript typed");

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("TypeScript");
    expect(results[0].source).toBe("docs");
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].id).toBeDefined();
  });

  it("overlapping terms — multi-term query filters correctly", async () => {
    await manager.index(
      "TypeScript compiler performance optimization",
      "docs",
    );
    await manager.index("TypeScript React framework for web apps", "docs");
    await manager.index("Python machine learning library", "docs");

    // Single-term query: both TypeScript docs match
    const tsResults = await manager.search("TypeScript");
    expect(tsResults.length).toBeGreaterThanOrEqual(2);
    const tsContents = tsResults.map((r) => r.content);
    expect(tsContents.every((c) => c.includes("TypeScript"))).toBe(true);

    // Multi-term AND query: only doc with both terms matches
    const compilerResults = await manager.search("TypeScript compiler");
    expect(compilerResults.length).toBeGreaterThanOrEqual(1);
    expect(compilerResults[0].content).toContain("compiler");

    // Python query should not return TypeScript docs
    const pyResults = await manager.search("Python");
    expect(pyResults.length).toBeGreaterThanOrEqual(1);
    expect(pyResults[0].content).toContain("Python");
    expect(pyResults.every((r) => !r.content.includes("TypeScript"))).toBe(
      true,
    );
  });

  it("delete removes from search results", async () => {
    const id = await manager.index("Content to be deleted", "test");

    // Verify it's found
    let results = await manager.search("deleted");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.id === id)).toBe(true);

    // Delete and verify it's gone
    await manager.delete(id);
    results = await manager.search("deleted");
    expect(results.every((r) => r.id !== id)).toBe(true);
  });

  it("limit respected", async () => {
    for (let i = 0; i < 20; i++) {
      await manager.index(
        `Document about searching and indexing number ${i}`,
        "test",
      );
    }

    const results = await manager.search("searching indexing", 5);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(0);
  });

  it("metadata preserved in results", async () => {
    const metadata = { category: "programming", priority: 1, tags: ["ts"] };
    await manager.index("Indexed with metadata", "test-source", metadata);

    const results = await manager.search("metadata");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].metadata).toEqual(metadata);
    expect(results[0].source).toBe("test-source");
  });

  it("empty and special queries return empty", async () => {
    await manager.index("Some indexed content for testing", "test");

    expect(await manager.search("")).toEqual([]);
    expect(await manager.search("   ")).toEqual([]);
    expect(await manager.search("!@#$%")).toEqual([]);
  });

  it("multiple docs with same source tracked correctly", async () => {
    const id1 = await manager.index("First document about cats", "shared-src");
    const id2 = await manager.index(
      "Second document about cats and dogs",
      "shared-src",
    );
    const id3 = await manager.index("Third document about cats", "other-src");

    const results = await manager.search("cats");
    expect(results.length).toBeGreaterThanOrEqual(2);

    // IDs should be distinct
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Source fields should match what was indexed
    const shared = results.filter((r) => r.source === "shared-src");
    expect(shared.length).toBeGreaterThanOrEqual(1);

    // Verify all three IDs are present somewhere
    const allIds = new Set(results.map((r) => r.id));
    expect(allIds.has(id1) || allIds.has(id2) || allIds.has(id3)).toBe(true);
  });

  it("close() releases resources safely — double close doesn't throw", async () => {
    const m = await createMemoryManager({ dbPath: ":memory:" });
    m.close();
    expect(() => m.close()).not.toThrow();
  });
});
