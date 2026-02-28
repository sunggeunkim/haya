import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SenderProfileStore } from "../sessions/profile-store.js";
import { createProfileTools } from "./profile-tools.js";

describe("createProfileTools", () => {
  let dir: string;
  let store: SenderProfileStore;
  let tools: ReturnType<typeof createProfileTools>["tools"];
  let setSenderId: ReturnType<typeof createProfileTools>["setSenderId"];

  const findTool = (name: string) => {
    const t = tools.find((t) => t.name === name);
    if (!t) throw new Error(`Tool ${name} not found`);
    return t;
  };

  beforeEach(() => {
    dir = join(tmpdir(), `profile-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    store = new SenderProfileStore(dir);
    const result = createProfileTools(store);
    tools = result.tools;
    setSenderId = result.setSenderId;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // --- user_profile_set ---
  it("stores a value via user_profile_set", async () => {
    setSenderId("alice");
    const result = await findTool("user_profile_set").execute({ key: "name", value: "Alice" });
    expect(result).toContain("Saved");
    expect(await store.get("alice", "name")).toBe("Alice");
  });

  // --- user_profile_get ---
  it("retrieves a value via user_profile_get", async () => {
    setSenderId("bob");
    await store.set("bob", "city", "Tokyo");
    const result = await findTool("user_profile_get").execute({ key: "city" });
    expect(result).toBe("Tokyo");
  });

  it("returns 'not found' for a missing key", async () => {
    setSenderId("bob");
    const result = await findTool("user_profile_get").execute({ key: "nonexistent" });
    expect(result).toContain("No value found");
  });

  // --- user_profile_list ---
  it("lists all facts via user_profile_list", async () => {
    setSenderId("carol");
    await store.set("carol", "name", "Carol");
    await store.set("carol", "food", "pizza");
    const result = await findTool("user_profile_list").execute({});
    expect(result).toContain("name: Carol");
    expect(result).toContain("food: pizza");
  });

  it("returns empty message when no profile data exists", async () => {
    setSenderId("empty");
    const result = await findTool("user_profile_list").execute({});
    expect(result).toContain("No profile data");
  });

  // --- user_profile_delete ---
  it("deletes a fact via user_profile_delete", async () => {
    setSenderId("dave");
    await store.set("dave", "color", "red");
    const result = await findTool("user_profile_delete").execute({ key: "color" });
    expect(result).toContain("Removed");
    expect(await store.get("dave", "color")).toBeUndefined();
  });

  it("returns 'nothing to delete' for missing key", async () => {
    setSenderId("dave");
    const result = await findTool("user_profile_delete").execute({ key: "nope" });
    expect(result).toContain("nothing to delete");
  });

  // --- setSenderId switches context ---
  it("switches sender context between users", async () => {
    setSenderId("user-a");
    await findTool("user_profile_set").execute({ key: "name", value: "A" });

    setSenderId("user-b");
    await findTool("user_profile_set").execute({ key: "name", value: "B" });

    // Each user has their own profile
    setSenderId("user-a");
    const resultA = await findTool("user_profile_get").execute({ key: "name" });
    expect(resultA).toBe("A");

    setSenderId("user-b");
    const resultB = await findTool("user_profile_get").execute({ key: "name" });
    expect(resultB).toBe("B");
  });

  // --- no sender context ---
  it("throws when no sender context is set", async () => {
    // currentSenderId is "" by default
    await expect(
      findTool("user_profile_set").execute({ key: "x", value: "y" }),
    ).rejects.toThrow("No sender context");
  });

  // --- tool metadata ---
  it("has correct default policies", () => {
    expect(findTool("user_profile_set").defaultPolicy).toBe("allow");
    expect(findTool("user_profile_get").defaultPolicy).toBe("allow");
    expect(findTool("user_profile_list").defaultPolicy).toBe("allow");
    expect(findTool("user_profile_delete").defaultPolicy).toBe("confirm");
  });
});
