import { describe, it, expect, vi } from "vitest";
import { SkillRegistry } from "./registry.js";
import type { LoadedSkill, SkillManifest, SkillModule } from "./types.js";
import type { AgentTool } from "../agent/types.js";

function createTestManifest(
  overrides?: Partial<SkillManifest>,
): SkillManifest {
  return {
    id: "test-skill",
    name: "Test Skill",
    version: "1.0.0",
    description: "A test skill",
    main: "index.js",
    requiredEnvVars: [],
    permissions: { network: false, filesystem: false, shell: false },
    ...overrides,
  };
}

function createTestTool(overrides?: Partial<AgentTool>): AgentTool {
  return {
    name: "test-tool",
    description: "A test tool",
    parameters: {},
    execute: vi.fn(async () => "result"),
    ...overrides,
  };
}

function createTestSkill(overrides?: Partial<LoadedSkill>): LoadedSkill {
  return {
    manifest: createTestManifest(),
    module: { tools: [createTestTool()] },
    path: "/tmp/skills/test-skill",
    status: "loaded",
    ...overrides,
  };
}

describe("SkillRegistry", () => {
  it("registers and retrieves a skill", () => {
    const registry = new SkillRegistry();
    const skill = createTestSkill();

    registry.register(skill);

    const retrieved = registry.get("test-skill");
    expect(retrieved).toBeDefined();
    expect(retrieved!.manifest.id).toBe("test-skill");
    expect(retrieved!.status).toBe("loaded");
  });

  it("returns undefined for non-existent skill", () => {
    const registry = new SkillRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("throws ValidationError for duplicate skill ID", () => {
    const registry = new SkillRegistry();
    const skill = createTestSkill();

    registry.register(skill);

    expect(() => registry.register(skill)).toThrow("already registered");
  });

  it("lists all skills with status info", () => {
    const registry = new SkillRegistry();

    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "skill-a", name: "A" }),
      }),
    );
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "skill-b", name: "B" }),
      }),
    );

    const list = registry.list();
    expect(list).toHaveLength(2);

    const ids = list.map((s) => s.manifest.id).sort();
    expect(ids).toEqual(["skill-a", "skill-b"]);

    // Each entry should have the expected shape
    for (const entry of list) {
      expect(entry).toHaveProperty("manifest");
      expect(entry).toHaveProperty("status");
      expect(entry).toHaveProperty("path");
    }
  });

  it("getAllTools() aggregates tools from all loaded skills", () => {
    const registry = new SkillRegistry();

    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "weather" }),
        module: {
          tools: [
            createTestTool({ name: "get-forecast" }),
            createTestTool({ name: "get-current" }),
          ],
        },
      }),
    );
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "github" }),
        module: {
          tools: [createTestTool({ name: "list-repos" })],
        },
      }),
    );

    const tools = registry.getAllTools();

    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "github:list-repos",
      "weather:get-current",
      "weather:get-forecast",
    ]);
  });

  it("getAllTools() namespaces tool names with skill ID", () => {
    const registry = new SkillRegistry();

    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "spotify" }),
        module: {
          tools: [createTestTool({ name: "play" })],
        },
      }),
    );

    const tools = registry.getAllTools();
    expect(tools[0].name).toBe("spotify:play");
  });

  it("getAllTools() skips skills with error status", () => {
    const registry = new SkillRegistry();

    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "healthy" }),
        module: { tools: [createTestTool({ name: "healthy-tool" })] },
        status: "loaded",
      }),
    );
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "broken" }),
        module: { tools: [createTestTool({ name: "broken-tool" })] },
        status: "error",
        error: "some failure",
      }),
    );

    const tools = registry.getAllTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("healthy:healthy-tool");
  });

  it("getAllTools() skips disabled skills", () => {
    const registry = new SkillRegistry();

    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "disabled-skill" }),
        module: { tools: [createTestTool()] },
        status: "disabled",
      }),
    );

    const tools = registry.getAllTools();
    expect(tools).toHaveLength(0);
  });

  it("unregister() removes a skill and returns true", () => {
    const registry = new SkillRegistry();
    registry.register(createTestSkill());

    const removed = registry.unregister("test-skill");

    expect(removed).toBe(true);
    expect(registry.get("test-skill")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it("unregister() returns false for non-existent skill", () => {
    const registry = new SkillRegistry();
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("setupAll() calls setup on all loaded skills", async () => {
    const setupA = vi.fn(async () => {});
    const setupB = vi.fn(async () => {});

    const registry = new SkillRegistry();
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "skill-a" }),
        module: { tools: [], setup: setupA },
      }),
    );
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "skill-b" }),
        module: { tools: [], setup: setupB },
      }),
    );

    await registry.setupAll();

    expect(setupA).toHaveBeenCalledTimes(1);
    expect(setupB).toHaveBeenCalledTimes(1);
  });

  it("setupAll() marks skill as error when setup throws", async () => {
    const registry = new SkillRegistry();
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "failing-setup" }),
        module: {
          tools: [],
          setup: async () => {
            throw new Error("Setup exploded");
          },
        },
      }),
    );

    await registry.setupAll();

    const skill = registry.get("failing-setup");
    expect(skill!.status).toBe("error");
    expect(skill!.error).toBe("Setup exploded");
  });

  it("setupAll() skips skills that are not in loaded status", async () => {
    const setup = vi.fn(async () => {});

    const registry = new SkillRegistry();
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "error-skill" }),
        module: { tools: [], setup },
        status: "error",
      }),
    );

    await registry.setupAll();

    expect(setup).not.toHaveBeenCalled();
  });

  it("teardownAll() calls teardown on all skills", async () => {
    const teardownA = vi.fn(async () => {});
    const teardownB = vi.fn(async () => {});

    const registry = new SkillRegistry();
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "skill-a" }),
        module: { tools: [], teardown: teardownA },
      }),
    );
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "skill-b" }),
        module: { tools: [], teardown: teardownB },
      }),
    );

    await registry.teardownAll();

    expect(teardownA).toHaveBeenCalledTimes(1);
    expect(teardownB).toHaveBeenCalledTimes(1);
  });

  it("teardownAll() continues when one teardown throws", async () => {
    const teardownB = vi.fn(async () => {});

    const registry = new SkillRegistry();
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "skill-a" }),
        module: {
          tools: [],
          teardown: async () => {
            throw new Error("teardown fail");
          },
        },
      }),
    );
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "skill-b" }),
        module: { tools: [], teardown: teardownB },
      }),
    );

    await registry.teardownAll();

    // Second teardown should still have been called
    expect(teardownB).toHaveBeenCalledTimes(1);
  });

  it("teardownAll() skips skills without teardown", async () => {
    const registry = new SkillRegistry();
    registry.register(
      createTestSkill({
        manifest: createTestManifest({ id: "no-teardown" }),
        module: { tools: [] },
      }),
    );

    // Should not throw
    await expect(registry.teardownAll()).resolves.toBeUndefined();
  });

  it("getAllTools() returns empty array when no skills registered", () => {
    const registry = new SkillRegistry();
    expect(registry.getAllTools()).toEqual([]);
  });

  it("re-registering after unregister succeeds", () => {
    const registry = new SkillRegistry();
    const skill = createTestSkill();

    registry.register(skill);
    registry.unregister("test-skill");
    registry.register(skill);

    expect(registry.get("test-skill")).toBeDefined();
  });
});
