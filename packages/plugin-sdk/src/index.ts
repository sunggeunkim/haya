/**
 * @haya/plugin-sdk — SDK for Haya plugin authors.
 *
 * Plugins export a PluginDefinition with:
 *   - id: unique plugin identifier (lowercase alphanumeric, dots, hyphens, underscores)
 *   - name: human-readable name
 *   - version: semver string (optional)
 *   - permissions: filesystem/network access the plugin needs (optional)
 *   - register(api): function called when the plugin is loaded
 *
 * Example:
 * ```typescript
 * import { definePlugin } from "@haya/plugin-sdk";
 *
 * export default definePlugin({
 *   id: "my-plugin",
 *   name: "My Plugin",
 *   version: "1.0.0",
 *   register(api) {
 *     api.registerTool({
 *       name: "greet",
 *       description: "Greets the user",
 *       parameters: { name: { type: "string" } },
 *       execute: async (args) => `Hello, ${args.name}!`,
 *     });
 *   },
 * });
 * ```
 */

export type {
  PluginDefinition,
  PluginApi,
  PluginPermissions,
  PluginLogger,
  HookHandler,
} from "@haya/core";

export type { AgentTool } from "@haya/core";

/**
 * Helper to define a plugin with type checking.
 * Simply returns the definition — no transformation.
 */
export function definePlugin(
  definition: import("@haya/core").PluginDefinition,
): import("@haya/core").PluginDefinition {
  return definition;
}
