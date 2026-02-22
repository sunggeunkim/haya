/**
 * Workspace guard that restricts filesystem access to a set of allowed roots.
 * Part of Phase 1 security hardening.
 */

import { realpathSync, existsSync } from "node:fs";
import { resolve, normalize } from "node:path";

/**
 * Error thrown when a path falls outside the allowed workspace roots.
 */
export class WorkspaceViolationError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Path is outside allowed workspace roots: ${path}`);
    this.name = "WorkspaceViolationError";
    this.path = path;
  }
}

/**
 * Guards filesystem operations by ensuring all accessed paths fall within
 * one of the configured workspace roots.
 *
 * Roots are resolved to their real (symlink-dereferenced) paths at
 * construction time when they exist on disk.
 */
export class WorkspaceGuard {
  private readonly roots: string[];

  constructor(roots: string[]) {
    this.roots = roots.map((root) => {
      const resolved = resolve(root);
      try {
        return realpathSync(resolved);
      } catch {
        return resolved;
      }
    });
  }

  /**
   * Validate that `inputPath` falls under an allowed root.
   * Returns the resolved real path on success; throws
   * `WorkspaceViolationError` on failure.
   */
  validatePath(inputPath: string): string {
    const resolved = resolve(inputPath);

    let realPath: string;
    if (existsSync(resolved)) {
      realPath = realpathSync(resolved);
    } else {
      realPath = normalize(resolved);
    }

    const allowed = this.roots.some(
      (root) => realPath === root || realPath.startsWith(root + "/"),
    );

    if (!allowed) {
      throw new WorkspaceViolationError(realPath);
    }

    return realPath;
  }

  /**
   * Non-throwing variant of `validatePath`.
   * Returns `true` when the path is inside an allowed root.
   */
  isAllowed(inputPath: string): boolean {
    try {
      this.validatePath(inputPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return the resolved workspace roots (read-only view).
   */
  getRoots(): readonly string[] {
    return this.roots;
  }
}
