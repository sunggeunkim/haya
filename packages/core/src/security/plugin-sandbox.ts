import { Worker, type MessagePort } from "node:worker_threads";
import { resolve } from "node:path";
import type {
  PluginPermissions,
  HostToWorkerMessage,
  WorkerToHostMessage,
  WorkerPluginManifest,
} from "../plugins/types.js";

export interface SandboxedWorker {
  readonly worker: Worker;
  readonly pluginId: string;
  send(message: HostToWorkerMessage): void;
  onMessage(handler: (message: WorkerToHostMessage) => void): void;
  onError(handler: (error: Error) => void): void;
  terminate(): Promise<number>;
}

export interface SandboxOptions {
  pluginPath: string;
  pluginId: string;
  permissions?: PluginPermissions;
  pluginConfig?: Record<string, unknown>;
  workerScript?: string;
  timeout?: number;
}

/**
 * Build the execArgv flags to restrict the worker via Node.js permission model.
 * Without any --allow-* flags combined with --experimental-permission,
 * the worker has NO access to filesystem, network, or child processes.
 */
export function buildPermissionFlags(
  permissions?: PluginPermissions,
): string[] {
  const flags: string[] = ["--experimental-permission"];

  if (permissions?.fileSystemRead) {
    for (const p of permissions.fileSystemRead) {
      const resolved = resolve(p);
      flags.push(`--allow-fs-read=${resolved}`);
    }
  }

  if (permissions?.fileSystemWrite) {
    for (const p of permissions.fileSystemWrite) {
      const resolved = resolve(p);
      flags.push(`--allow-fs-write=${resolved}`);
    }
  }

  // Network and child process are off by default.
  // Only explicitly granted permissions are allowed.
  // Note: --allow-child-process and network permissions
  // are intentionally NOT supported to minimize attack surface.

  return flags;
}

/**
 * Launch a plugin in a sandboxed worker_thread with restricted permissions.
 */
export function createSandboxedWorker(
  options: SandboxOptions,
): SandboxedWorker {
  const {
    pluginPath,
    pluginId,
    permissions,
    pluginConfig,
    workerScript,
  } = options;

  // Resolve the plugin path to an absolute path
  const resolvedPluginPath = resolve(pluginPath);

  // Build permission flags
  const execArgv = buildPermissionFlags(permissions);

  // The worker script is the entry point that loads the plugin module.
  // If not provided, use pluginPath directly (the plugin must be a valid worker script).
  const workerPath = workerScript ?? resolvedPluginPath;

  const worker = new Worker(workerPath, {
    workerData: {
      pluginPath: resolvedPluginPath,
      pluginId,
      pluginConfig: pluginConfig ?? {},
    },
    execArgv,
  });

  // Default error handler to prevent uncaught worker errors from crashing the host
  let lastError: Error | null = null;
  worker.on("error", (err) => { lastError = err; });

  return {
    worker,
    pluginId,

    send(message: HostToWorkerMessage): void {
      worker.postMessage(message);
    },

    onMessage(handler: (message: WorkerToHostMessage) => void): void {
      worker.on("message", handler);
    },

    onError(handler: (error: Error) => void): void {
      worker.on("error", handler);
    },

    terminate(): Promise<number> {
      return worker.terminate();
    },
  };
}

/**
 * Validate that a plugin manifest doesn't request dangerous permissions.
 */
export function validatePluginPermissions(
  manifest: WorkerPluginManifest,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (manifest.permissions?.childProcess) {
    errors.push(
      `Plugin "${manifest.id}" requests childProcess permission, which is not allowed`,
    );
  }

  if (manifest.permissions?.fileSystemRead) {
    for (const p of manifest.permissions.fileSystemRead) {
      if (p === "/" || p === "*") {
        errors.push(
          `Plugin "${manifest.id}" requests unrestricted filesystem read access`,
        );
      }
    }
  }

  if (manifest.permissions?.fileSystemWrite) {
    for (const p of manifest.permissions.fileSystemWrite) {
      if (p === "/" || p === "*") {
        errors.push(
          `Plugin "${manifest.id}" requests unrestricted filesystem write access`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
