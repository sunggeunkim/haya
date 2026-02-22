import { describe, it, expect, vi } from "vitest";
import { createMemoryTools } from "./memory-tools.js";
import type { MemorySearchManager, MemorySearchResult } from "../memory/types.js";

function createMockMemoryManager(): MemorySearchManager {
  return {
    index: vi.fn().mockResolvedValue("mem-abc-123"),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
}

describe("createMemoryTools", () => {
  it("returns three tools", () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "memory_store",
      "memory_search",
      "memory_delete",
    ]);
  });

  it("all tools have required fields", () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.defaultPolicy).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});

describe("memory_store", () => {
  it("stores content and returns the ID", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const store = tools.find((t) => t.name === "memory_store")!;

    const result = await store.execute({
      content: "The user's favorite color is blue",
      source: "user",
    });

    expect(result).toContain("mem-abc-123");
    expect(manager.index).toHaveBeenCalledWith(
      "The user's favorite color is blue",
      "user",
      {},
    );
  });

  it("passes metadata to index", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const store = tools.find((t) => t.name === "memory_store")!;

    await store.execute({
      content: "Meeting at 3pm",
      source: "conversation",
      metadata: { topic: "work" },
    });

    expect(manager.index).toHaveBeenCalledWith(
      "Meeting at 3pm",
      "conversation",
      { topic: "work" },
    );
  });

  it("throws if content is missing", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const store = tools.find((t) => t.name === "memory_store")!;

    await expect(store.execute({ source: "user" })).rejects.toThrow(
      "content is required",
    );
  });

  it("throws if source is missing", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const store = tools.find((t) => t.name === "memory_store")!;

    await expect(store.execute({ content: "hello" })).rejects.toThrow(
      "source is required",
    );
  });
});

describe("memory_search", () => {
  it("returns formatted results", async () => {
    const manager = createMockMemoryManager();
    const results: MemorySearchResult[] = [
      {
        id: "mem-1",
        content: "User likes blue",
        source: "user",
        score: 0.95,
        metadata: {},
      },
      {
        id: "mem-2",
        content: "User has a cat named Whiskers",
        source: "conversation",
        score: 0.72,
        metadata: {},
      },
    ];
    (manager.search as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const tools = createMemoryTools(manager);
    const search = tools.find((t) => t.name === "memory_search")!;

    const result = await search.execute({ query: "favorite color" });

    expect(result).toContain("mem-1");
    expect(result).toContain("0.950");
    expect(result).toContain("User likes blue");
    expect(result).toContain("mem-2");
    expect(manager.search).toHaveBeenCalledWith("favorite color", 5);
  });

  it("uses custom limit", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const search = tools.find((t) => t.name === "memory_search")!;

    await search.execute({ query: "test", limit: 10 });
    expect(manager.search).toHaveBeenCalledWith("test", 10);
  });

  it("returns no-results message when empty", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const search = tools.find((t) => t.name === "memory_search")!;

    const result = await search.execute({ query: "nothing here" });
    expect(result).toBe("No matching memories found.");
  });

  it("throws if query is missing", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const search = tools.find((t) => t.name === "memory_search")!;

    await expect(search.execute({})).rejects.toThrow("query is required");
  });
});

describe("memory_delete", () => {
  it("deletes by ID", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const del = tools.find((t) => t.name === "memory_delete")!;

    const result = await del.execute({ id: "mem-abc-123" });
    expect(result).toContain("mem-abc-123");
    expect(manager.delete).toHaveBeenCalledWith("mem-abc-123");
  });

  it("throws if id is missing", async () => {
    const manager = createMockMemoryManager();
    const tools = createMemoryTools(manager);
    const del = tools.find((t) => t.name === "memory_delete")!;

    await expect(del.execute({})).rejects.toThrow("id is required");
  });
});
