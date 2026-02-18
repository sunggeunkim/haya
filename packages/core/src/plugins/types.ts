import type { AgentTool } from "../agent/types.js";

/**
 * Permissions a plugin can request. The sandbox enforces these
 * via Node.js 22+ --experimental-permission flags.
 */
export interface PluginPermissions {
  fileSystemRead?: string[];
  fileSystemWrite?: string[];
  network?: boolean;
  childProcess?: boolean;
}

/**
 * Plugin definition provided by plugin authors.
 */
export interface PluginDefinition {
  id: string;
  name: string;
  version?: string;
  permissions?: PluginPermissions;
  register: (api: PluginApi) => void | Promise<void>;
}

/**
 * API surface exposed to plugins during registration.
 */
export interface PluginApi {
  registerTool: (tool: AgentTool) => void;
  registerHook: (event: string, handler: HookHandler) => void;
  logger: PluginLogger;
}

export type HookHandler = (
  payload: Record<string, unknown>,
) => void | Promise<void>;

export interface PluginLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

/**
 * Internal representation of a loaded plugin.
 */
export interface LoadedPlugin {
  definition: PluginDefinition;
  status: PluginStatus;
  error?: string;
}

export type PluginStatus = "loaded" | "registered" | "failed" | "unloaded";

/**
 * Messages sent between host and plugin worker.
 */
export type HostToWorkerMessage =
  | { type: "init"; pluginConfig?: Record<string, unknown> }
  | { type: "hook"; event: string; payload: Record<string, unknown> }
  | { type: "tool-call"; toolName: string; args: Record<string, unknown>; callId: string }
  | { type: "shutdown" };

export type WorkerToHostMessage =
  | { type: "ready"; definition: WorkerPluginManifest }
  | { type: "register-tool"; tool: WorkerToolDefinition }
  | { type: "register-hook"; event: string }
  | { type: "hook-result"; event: string; error?: string }
  | { type: "tool-result"; callId: string; result: string; isError?: boolean }
  | { type: "log"; level: "info" | "warn" | "error" | "debug"; message: string }
  | { type: "error"; message: string };

export interface WorkerPluginManifest {
  id: string;
  name: string;
  version?: string;
  permissions?: PluginPermissions;
}

export interface WorkerToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
