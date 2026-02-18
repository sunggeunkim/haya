import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "./registry.js";
import type { PluginDefinition } from "./types.js";
import { HookRegistry } from "./hooks.js";
import { ToolRegistry } from "../agent/tools.js";

function createTestPlugin(
  overrides?: Partial<PluginDefinition>,
): PluginDefinition {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    register: vi.fn(),
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  it("registers a plugin successfully", async () => {
    const registry = new PluginRegistry();
    const plugin = createTestPlugin();

    await registry.register(plugin);

    expect(registry.has("test-plugin")).toBe(true);
    expect(registry.size).toBe(1);
    expect(plugin.register).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate plugin registration", async () => {
    const registry = new PluginRegistry();
    const plugin = createTestPlugin();

    await registry.register(plugin);
    await expect(registry.register(plugin)).rejects.toThrow(
      "already registered",
    );
  });

  it("rejects plugin with missing id", async () => {
    const registry = new PluginRegistry();
    const plugin = createTestPlugin({ id: "" });

    await expect(registry.register(plugin)).rejects.toThrow("Plugin ID");
  });

  it("rejects plugin with invalid id format", async () => {
    const registry = new PluginRegistry();
    const plugin = createTestPlugin({ id: "Invalid Plugin!" });

    await expect(registry.register(plugin)).rejects.toThrow(
      "lowercase alphanumeric",
    );
  });

  it("accepts plugin with dots and hyphens in id", async () => {
    const registry = new PluginRegistry();
    const plugin = createTestPlugin({ id: "my-plugin.v2" });

    await registry.register(plugin);
    expect(registry.has("my-plugin.v2")).toBe(true);
  });

  it("rejects plugin with missing name", async () => {
    const registry = new PluginRegistry();
    const plugin = createTestPlugin({ name: "" });

    await expect(registry.register(plugin)).rejects.toThrow("Plugin name");
  });

  it("sets status to failed when register() throws", async () => {
    const registry = new PluginRegistry();
    const plugin = createTestPlugin({
      register: () => {
        throw new Error("Registration failed");
      },
    });

    await expect(registry.register(plugin)).rejects.toThrow(
      "Registration failed",
    );

    const loaded = registry.get("test-plugin");
    expect(loaded?.status).toBe("failed");
    expect(loaded?.error).toBe("Registration failed");
  });

  it("passes a PluginApi to register()", async () => {
    const registry = new PluginRegistry();
    let receivedApi: unknown;

    const plugin = createTestPlugin({
      register: (api) => {
        receivedApi = api;
      },
    });

    await registry.register(plugin);

    expect(receivedApi).toBeDefined();
    const api = receivedApi as Record<string, unknown>;
    expect(typeof api.registerTool).toBe("function");
    expect(typeof api.registerHook).toBe("function");
    expect(api.logger).toBeDefined();
  });

  it("namespaces tools registered by plugins", async () => {
    const toolRegistry = new ToolRegistry();
    const registry = new PluginRegistry(new HookRegistry(), toolRegistry);

    const plugin = createTestPlugin({
      register: (api) => {
        api.registerTool({
          name: "greet",
          description: "Greets a user",
          parameters: {},
          execute: async () => "Hello!",
        });
      },
    });

    await registry.register(plugin);

    expect(toolRegistry.has("test-plugin:greet")).toBe(true);
    expect(toolRegistry.has("greet")).toBe(false);
  });

  it("registers hooks via plugin api", async () => {
    const hookRegistry = new HookRegistry();
    const registry = new PluginRegistry(hookRegistry);

    const handler = vi.fn();
    const plugin = createTestPlugin({
      register: (api) => {
        api.registerHook("on-message", handler);
      },
    });

    await registry.register(plugin);

    expect(hookRegistry.handlerCount("on-message")).toBe(1);
    await hookRegistry.dispatch("on-message", { text: "hello" });
    expect(handler).toHaveBeenCalledWith({ text: "hello" });
  });

  it("unregisters a plugin", async () => {
    const toolRegistry = new ToolRegistry();
    const registry = new PluginRegistry(new HookRegistry(), toolRegistry);

    const plugin = createTestPlugin({
      register: (api) => {
        api.registerTool({
          name: "greet",
          description: "Greet",
          parameters: {},
          execute: async () => "Hello!",
        });
      },
    });

    await registry.register(plugin);
    expect(registry.has("test-plugin")).toBe(true);
    expect(toolRegistry.has("test-plugin:greet")).toBe(true);

    const removed = registry.unregister("test-plugin");
    expect(removed).toBe(true);
    expect(registry.has("test-plugin")).toBe(false);
    expect(toolRegistry.has("test-plugin:greet")).toBe(false);
  });

  it("returns false when unregistering non-existent plugin", () => {
    const registry = new PluginRegistry();
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("lists all registered plugins", async () => {
    const registry = new PluginRegistry();
    await registry.register(createTestPlugin({ id: "plugin-a", name: "A" }));
    await registry.register(createTestPlugin({ id: "plugin-b", name: "B" }));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.definition.id)).toContain("plugin-a");
    expect(list.map((p) => p.definition.id)).toContain("plugin-b");
  });

  it("gets a loaded plugin by id", async () => {
    const registry = new PluginRegistry();
    await registry.register(createTestPlugin());

    const loaded = registry.get("test-plugin");
    expect(loaded).toBeDefined();
    expect(loaded!.definition.id).toBe("test-plugin");
    expect(loaded!.status).toBe("registered");
  });

  it("returns undefined for non-existent plugin", () => {
    const registry = new PluginRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("exposes hooks and tools registries", () => {
    const hookRegistry = new HookRegistry();
    const toolRegistry = new ToolRegistry();
    const registry = new PluginRegistry(hookRegistry, toolRegistry);

    expect(registry.hooks).toBe(hookRegistry);
    expect(registry.tools).toBe(toolRegistry);
  });

  it("creates default hook and tool registries if not provided", () => {
    const registry = new PluginRegistry();
    expect(registry.hooks).toBeDefined();
    expect(registry.tools).toBeDefined();
  });

  it("handles async register functions", async () => {
    const registry = new PluginRegistry();
    let registered = false;

    const plugin = createTestPlugin({
      register: async () => {
        await new Promise((r) => setTimeout(r, 10));
        registered = true;
      },
    });

    await registry.register(plugin);
    expect(registered).toBe(true);
    expect(registry.get("test-plugin")?.status).toBe("registered");
  });

  it("provides a scoped logger to plugins", async () => {
    const registry = new PluginRegistry();
    let loggerRef: unknown;

    const plugin = createTestPlugin({
      register: (api) => {
        loggerRef = api.logger;
      },
    });

    await registry.register(plugin);

    const logger = loggerRef as Record<string, unknown>;
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });
});
