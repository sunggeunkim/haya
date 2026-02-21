import type {
  LoadedPlugin,
  PluginDefinition,
  PluginStatus,
  PluginApi,
} from "./types.js";
import type { AgentTool } from "../agent/types.js";
import { HookRegistry } from "./hooks.js";
import { ToolRegistry } from "../agent/tools.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("plugin-registry");

/**
 * Manages the lifecycle of all loaded plugins: registration, lookup,
 * tool/hook wiring, and unloading.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly hookRegistry: HookRegistry;
  private readonly toolRegistry: ToolRegistry;

  constructor(
    hookRegistry?: HookRegistry,
    toolRegistry?: ToolRegistry,
  ) {
    this.hookRegistry = hookRegistry ?? new HookRegistry();
    this.toolRegistry = toolRegistry ?? new ToolRegistry();
  }

  /**
   * Register a plugin by calling its register() function with a PluginApi.
   * Validates the plugin definition before registration.
   */
  async register(definition: PluginDefinition): Promise<void> {
    if (this.plugins.has(definition.id)) {
      throw new Error(`Plugin "${definition.id}" is already registered`);
    }

    // Validate plugin definition
    const errors = validatePluginDefinition(definition);
    if (errors.length > 0) {
      throw new Error(
        `Invalid plugin "${definition.id}": ${errors.join("; ")}`,
      );
    }

    const entry: LoadedPlugin = {
      definition,
      status: "loaded",
    };
    this.plugins.set(definition.id, entry);

    // Build the PluginApi for this plugin
    const api = this.buildPluginApi(definition.id);

    try {
      await definition.register(api);
      entry.status = "registered";
      log.info(`Plugin "${definition.id}" registered successfully`);
    } catch (err) {
      entry.status = "failed";
      entry.error = err instanceof Error ? err.message : String(err);
      log.error(
        `Plugin "${definition.id}" failed to register: ${entry.error}`,
      );
      throw err;
    }
  }

  /**
   * Unregister a plugin and clean up its tools and hooks.
   */
  unregister(pluginId: string): boolean {
    const entry = this.plugins.get(pluginId);
    if (!entry) return false;

    // Remove tools registered by this plugin
    for (const tool of this.toolRegistry.list()) {
      if (tool.name.startsWith(`${pluginId}:`)) {
        this.toolRegistry.unregister(tool.name);
      }
    }

    // Remove hooks registered by this plugin
    this.hookRegistry.unregisterByPlugin(pluginId);

    entry.status = "unloaded";
    this.plugins.delete(pluginId);
    log.info(`Plugin "${pluginId}" unregistered`);
    return true;
  }

  /**
   * Get a loaded plugin by ID.
   */
  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Check if a plugin is registered.
   */
  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * List all registered plugins.
   */
  list(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get the number of registered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Get the hook registry used by plugins.
   */
  get hooks(): HookRegistry {
    return this.hookRegistry;
  }

  /**
   * Get the tool registry used by plugins.
   */
  get tools(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Build a PluginApi scoped to a specific plugin.
   */
  private buildPluginApi(pluginId: string): PluginApi {
    const toolRegistry = this.toolRegistry;
    const hookRegistry = this.hookRegistry;

    const pluginLogger = {
      info: (message: string) => log.info(`[${pluginId}] ${message}`),
      warn: (message: string) => log.warn(`[${pluginId}] ${message}`),
      error: (message: string) => log.error(`[${pluginId}] ${message}`),
      debug: (message: string) => log.debug(`[${pluginId}] ${message}`),
    };

    return {
      registerTool(tool: AgentTool): void {
        // Namespace the tool with the plugin ID to avoid collisions
        const namespacedTool: AgentTool = {
          ...tool,
          name: `${pluginId}:${tool.name}`,
        };
        toolRegistry.register(namespacedTool);
        pluginLogger.info(`Registered tool: ${namespacedTool.name}`);
      },

      registerHook(event: string, handler): void {
        hookRegistry.register(event, handler, pluginId);
        pluginLogger.info(`Registered hook: ${event}`);
      },

      logger: pluginLogger,
    };
  }
}

/**
 * Validate a plugin definition.
 */
function validatePluginDefinition(
  definition: PluginDefinition,
): string[] {
  const errors: string[] = [];

  if (!definition.id || typeof definition.id !== "string") {
    errors.push("Plugin ID is required and must be a non-empty string");
  } else if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(definition.id)) {
    errors.push(
      "Plugin ID must be lowercase alphanumeric with dots, hyphens, or underscores",
    );
  }

  if (!definition.name || typeof definition.name !== "string") {
    errors.push("Plugin name is required and must be a non-empty string");
  }

  if (typeof definition.register !== "function") {
    errors.push("Plugin register must be a function");
  }

  if (definition.version !== undefined && typeof definition.version !== "string") {
    errors.push("Plugin version must be a string if provided");
  }

  return errors;
}
