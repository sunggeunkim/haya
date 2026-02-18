import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadPluginModule, loadPlugins } from "./loader.js";
import { PluginRegistry } from "./registry.js";

describe("loadPluginModule", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `haya-plugin-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads a plugin from a file with default export", async () => {
    const pluginPath = join(testDir, "test-plugin.mjs");
    await writeFile(
      pluginPath,
      `
      export default {
        id: "test-default",
        name: "Test Default Plugin",
        version: "1.0.0",
        register(api) {
          api.logger.info("Plugin loaded!");
        }
      };
      `,
    );

    const definition = await loadPluginModule(pluginPath);
    expect(definition.id).toBe("test-default");
    expect(definition.name).toBe("Test Default Plugin");
    expect(typeof definition.register).toBe("function");
  });

  it("loads a plugin from a file with named 'plugin' export", async () => {
    const pluginPath = join(testDir, "named-plugin.mjs");
    await writeFile(
      pluginPath,
      `
      export const plugin = {
        id: "test-named",
        name: "Test Named Plugin",
        register(api) {}
      };
      `,
    );

    const definition = await loadPluginModule(pluginPath);
    expect(definition.id).toBe("test-named");
  });

  it("throws for non-existent file", async () => {
    await expect(
      loadPluginModule(join(testDir, "nonexistent.mjs")),
    ).rejects.toThrow("Plugin file not found");
  });

  it("throws for directory path", async () => {
    await expect(loadPluginModule(testDir)).rejects.toThrow(
      "not a file",
    );
  });

  it("throws for module without plugin export", async () => {
    const pluginPath = join(testDir, "no-export.mjs");
    await writeFile(pluginPath, "export const foo = 'bar';");

    await expect(loadPluginModule(pluginPath)).rejects.toThrow(
      "does not export a PluginDefinition",
    );
  });

  it("throws for module without register function", async () => {
    const pluginPath = join(testDir, "no-register.mjs");
    await writeFile(
      pluginPath,
      `
      export default {
        id: "no-register",
        name: "No Register Plugin",
      };
      `,
    );

    await expect(loadPluginModule(pluginPath)).rejects.toThrow(
      "register function",
    );
  });

  it("throws for invalid JavaScript", async () => {
    const pluginPath = join(testDir, "invalid.mjs");
    await writeFile(pluginPath, "this is not valid javascript {{{");

    await expect(loadPluginModule(pluginPath)).rejects.toThrow(
      "Failed to load plugin module",
    );
  });
});

describe("loadPlugins", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `haya-plugin-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads multiple plugins successfully", async () => {
    const pluginA = join(testDir, "plugin-a.mjs");
    const pluginB = join(testDir, "plugin-b.mjs");

    await writeFile(
      pluginA,
      `export default { id: "plugin-a", name: "A", register() {} };`,
    );
    await writeFile(
      pluginB,
      `export default { id: "plugin-b", name: "B", register() {} };`,
    );

    const registry = new PluginRegistry();
    const result = await loadPlugins([pluginA, pluginB], registry);

    expect(result.loaded).toEqual(["plugin-a", "plugin-b"]);
    expect(result.failed).toHaveLength(0);
    expect(registry.size).toBe(2);
  });

  it("continues loading when one plugin fails", async () => {
    const goodPlugin = join(testDir, "good.mjs");
    const badPlugin = join(testDir, "bad.mjs");

    await writeFile(
      goodPlugin,
      `export default { id: "good", name: "Good", register() {} };`,
    );
    // bad.mjs doesn't exist — will fail

    const registry = new PluginRegistry();
    const result = await loadPlugins(
      [badPlugin, goodPlugin],
      registry,
    );

    expect(result.loaded).toEqual(["good"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toBe(badPlugin);
    expect(result.failed[0].error).toBeDefined();
  });

  it("returns empty results for empty paths", async () => {
    const registry = new PluginRegistry();
    const result = await loadPlugins([], registry);

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
