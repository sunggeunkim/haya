import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { PluginDefinition } from "./types.js";
import { PluginRegistry } from "./registry.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("plugin-loader");

/**
 * Load a plugin module from a file path.
 * The module must export a PluginDefinition as default or named export.
 */
export async function loadPluginModule(
  pluginPath: string,
): Promise<PluginDefinition> {
  const resolvedPath = resolve(pluginPath);

  // Verify the file exists
  try {
    const stats = await stat(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Plugin path is not a file: ${resolvedPath}`);
    }
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(`Plugin file not found: ${resolvedPath}`);
    }
    throw err;
  }

  // Dynamic import the plugin module
  let mod: Record<string, unknown>;
  try {
    mod = (await import(resolvedPath)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to load plugin module: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Look for plugin definition as default export or named 'plugin' export
  const definition = (mod.default ?? mod.plugin) as
    | PluginDefinition
    | undefined;

  if (!definition || typeof definition !== "object") {
    throw new Error(
      `Plugin module at "${resolvedPath}" does not export a PluginDefinition (expected default or named "plugin" export)`,
    );
  }

  if (typeof definition.register !== "function") {
    throw new Error(
      `Plugin "${definition.id ?? "unknown"}" does not have a register function`,
    );
  }

  return definition;
}

/**
 * Load and register multiple plugins from file paths.
 * Continues loading remaining plugins if one fails.
 */
export async function loadPlugins(
  pluginPaths: string[],
  registry: PluginRegistry,
): Promise<{
  loaded: string[];
  failed: Array<{ path: string; error: string }>;
}> {
  const loaded: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const pluginPath of pluginPaths) {
    try {
      const definition = await loadPluginModule(pluginPath);
      await registry.register(definition);
      loaded.push(definition.id);
      log.info(`Loaded plugin "${definition.id}" from ${pluginPath}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ path: pluginPath, error });
      log.error(`Failed to load plugin from ${pluginPath}: ${error}`);
    }
  }

  return { loaded, failed };
}
