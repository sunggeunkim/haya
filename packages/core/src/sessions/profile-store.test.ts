import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SenderProfileStore } from "./profile-store.js";

describe("SenderProfileStore", () => {
  let dir: string;
  let store: SenderProfileStore;

  beforeEach(() => {
    dir = join(tmpdir(), `profile-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    store = new SenderProfileStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // --- load / save round-trip ---
  it("round-trips a profile through save and load", async () => {
    const profile = { name: "Alex", location: "San Jose" };
    await store.save("user-1", profile);
    const loaded = await store.load("user-1");
    expect(loaded).toEqual(profile);
  });

  // --- get / set individual keys ---
  it("sets and gets individual keys", async () => {
    await store.set("user-2", "name", "Bob");
    await store.set("user-2", "color", "blue");
    expect(await store.get("user-2", "name")).toBe("Bob");
    expect(await store.get("user-2", "color")).toBe("blue");
  });

  it("overwrites an existing key", async () => {
    await store.set("user-3", "city", "LA");
    await store.set("user-3", "city", "NYC");
    expect(await store.get("user-3", "city")).toBe("NYC");
  });

  // --- delete ---
  it("deletes a key and returns true", async () => {
    await store.set("user-4", "food", "sushi");
    const deleted = await store.delete("user-4", "food");
    expect(deleted).toBe(true);
    expect(await store.get("user-4", "food")).toBeUndefined();
  });

  it("returns false when deleting a non-existent key", async () => {
    const deleted = await store.delete("user-5", "nope");
    expect(deleted).toBe(false);
  });

  // --- list ---
  it("lists all keys for a sender", async () => {
    await store.set("user-6", "a", "1");
    await store.set("user-6", "b", "2");
    const all = await store.list("user-6");
    expect(all).toEqual({ a: "1", b: "2" });
  });

  // --- nonexistent sender ---
  it("returns empty object for a sender with no profile", async () => {
    const profile = await store.load("unknown-user");
    expect(profile).toEqual({});
  });

  it("returns undefined for get on nonexistent sender", async () => {
    expect(await store.get("ghost", "name")).toBeUndefined();
  });

  // --- sender ID sanitization ---
  it("sanitizes sender IDs for filesystem safety", () => {
    expect(store.sanitizeId("user@example.com")).toBe("user-example-com");
    expect(store.sanitizeId("slack:U12345")).toBe("slack-U12345");
    expect(store.sanitizeId("simple")).toBe("simple");
    expect(store.sanitizeId("a/b/../c")).toBe("a-b----c");
  });

  it("throws on empty sender ID", () => {
    expect(() => store.sanitizeId("")).toThrow("Invalid sender ID");
  });

  // --- formatForPrompt ---
  it("formats a profile as a prompt section", () => {
    const text = store.formatForPrompt({ name: "Alex", location: "San Jose" });
    expect(text).toContain("[User Profile]");
    expect(text).toContain("- name: Alex");
    expect(text).toContain("- location: San Jose");
  });

  it("returns empty string for empty profile", () => {
    expect(store.formatForPrompt({})).toBe("");
  });

  // --- file permissions ---
  it("writes profile files with 0o600 permissions", async () => {
    await store.set("user-perms", "k", "v");
    const filePath = join(dir, "user-perms.json");
    expect(existsSync(filePath)).toBe(true);
    const stat = statSync(filePath);
    // eslint-disable-next-line no-bitwise
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  // --- creates directory if missing ---
  it("creates the data directory on first write", async () => {
    const nested = join(dir, "sub", "profiles");
    const nestedStore = new SenderProfileStore(nested);
    await nestedStore.set("u1", "x", "y");
    expect(existsSync(nested)).toBe(true);
    expect(await nestedStore.get("u1", "x")).toBe("y");
  });

  // --- JSON format ---
  it("stores profile as valid JSON", async () => {
    await store.set("json-check", "key", "value");
    const raw = readFileSync(join(dir, "json-check.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ key: "value" });
  });
});
