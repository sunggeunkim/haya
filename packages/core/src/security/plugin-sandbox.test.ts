import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  buildPermissionFlags,
  validatePluginPermissions,
} from "./plugin-sandbox.js";
import type { WorkerPluginManifest } from "../plugins/types.js";

describe("buildPermissionFlags", () => {
  it("returns only --experimental-permission with no permissions", () => {
    const flags = buildPermissionFlags();
    expect(flags).toEqual(["--experimental-permission"]);
  });

  it("returns only --experimental-permission with empty permissions", () => {
    const flags = buildPermissionFlags({});
    expect(flags).toEqual(["--experimental-permission"]);
  });

  it("adds --allow-fs-read for fileSystemRead paths", () => {
    const flags = buildPermissionFlags({
      fileSystemRead: ["/tmp/data", "/home/user/docs"],
    });
    expect(flags).toContain("--experimental-permission");
    expect(flags).toContain(`--allow-fs-read=${resolve("/tmp/data")}`);
    expect(flags).toContain(`--allow-fs-read=${resolve("/home/user/docs")}`);
  });

  it("adds --allow-fs-write for fileSystemWrite paths", () => {
    const flags = buildPermissionFlags({
      fileSystemWrite: ["/tmp/output"],
    });
    expect(flags).toContain(`--allow-fs-write=${resolve("/tmp/output")}`);
  });

  it("resolves relative paths to absolute", () => {
    const flags = buildPermissionFlags({
      fileSystemRead: ["./relative/path"],
    });
    const expected = resolve("./relative/path");
    expect(flags).toContain(`--allow-fs-read=${expected}`);
    // Ensure it's an absolute path
    expect(expected.startsWith("/")).toBe(true);
  });

  it("combines read and write permissions", () => {
    const flags = buildPermissionFlags({
      fileSystemRead: ["/data"],
      fileSystemWrite: ["/output"],
    });
    expect(flags).toHaveLength(3); // experimental-permission + read + write
    expect(flags[0]).toBe("--experimental-permission");
  });

  it("does not include network or child process flags", () => {
    const flags = buildPermissionFlags({
      network: true,
      childProcess: true,
    });
    // Only --experimental-permission should be present
    // Network and child process are intentionally not supported
    const flagStr = flags.join(" ");
    expect(flagStr).not.toContain("--allow-child-process");
    // --experimental-permission should always be first
    expect(flags[0]).toBe("--experimental-permission");
  });

  it("handles multiple read paths", () => {
    const flags = buildPermissionFlags({
      fileSystemRead: ["/a", "/b", "/c"],
    });
    expect(flags.filter((f) => f.startsWith("--allow-fs-read="))).toHaveLength(
      3,
    );
  });
});

describe("validatePluginPermissions", () => {
  it("validates a plugin with no permissions", () => {
    const manifest: WorkerPluginManifest = {
      id: "test-plugin",
      name: "Test Plugin",
    };
    const result = validatePluginPermissions(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates a plugin with safe permissions", () => {
    const manifest: WorkerPluginManifest = {
      id: "test-plugin",
      name: "Test Plugin",
      permissions: {
        fileSystemRead: ["/tmp/specific-dir"],
        fileSystemWrite: ["/tmp/output-dir"],
      },
    };
    const result = validatePluginPermissions(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects childProcess permission", () => {
    const manifest: WorkerPluginManifest = {
      id: "bad-plugin",
      name: "Bad Plugin",
      permissions: {
        childProcess: true,
      },
    };
    const result = validatePluginPermissions(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("childProcess");
  });

  it("rejects unrestricted filesystem read access via /", () => {
    const manifest: WorkerPluginManifest = {
      id: "greedy-plugin",
      name: "Greedy Plugin",
      permissions: {
        fileSystemRead: ["/"],
      },
    };
    const result = validatePluginPermissions(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("unrestricted filesystem read");
  });

  it("rejects unrestricted filesystem read access via *", () => {
    const manifest: WorkerPluginManifest = {
      id: "greedy-plugin",
      name: "Greedy Plugin",
      permissions: {
        fileSystemRead: ["*"],
      },
    };
    const result = validatePluginPermissions(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("unrestricted filesystem read");
  });

  it("rejects unrestricted filesystem write access", () => {
    const manifest: WorkerPluginManifest = {
      id: "greedy-plugin",
      name: "Greedy Plugin",
      permissions: {
        fileSystemWrite: ["/"],
      },
    };
    const result = validatePluginPermissions(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("unrestricted filesystem write");
  });

  it("collects multiple validation errors", () => {
    const manifest: WorkerPluginManifest = {
      id: "very-bad-plugin",
      name: "Very Bad Plugin",
      permissions: {
        childProcess: true,
        fileSystemRead: ["/"],
        fileSystemWrite: ["*"],
      },
    };
    const result = validatePluginPermissions(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("createSandboxedWorker", () => {
  it("returned object has the correct interface methods", async () => {
    const { createSandboxedWorker } = await import("./plugin-sandbox.js");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);

    const sandboxed = createSandboxedWorker({
      pluginPath: __filename,
      pluginId: "test-plugin",
    });

    try {
      expect(sandboxed).toHaveProperty("send");
      expect(sandboxed).toHaveProperty("onMessage");
      expect(sandboxed).toHaveProperty("onError");
      expect(sandboxed).toHaveProperty("terminate");
      expect(sandboxed).toHaveProperty("pluginId");
      expect(sandboxed).toHaveProperty("worker");
      expect(typeof sandboxed.send).toBe("function");
      expect(typeof sandboxed.onMessage).toBe("function");
      expect(typeof sandboxed.onError).toBe("function");
      expect(typeof sandboxed.terminate).toBe("function");
      expect(sandboxed.pluginId).toBe("test-plugin");
    } finally {
      await sandboxed.terminate();
    }
  });

  it("onError handler is callable", async () => {
    const { createSandboxedWorker } = await import("./plugin-sandbox.js");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);

    const sandboxed = createSandboxedWorker({
      pluginPath: __filename,
      pluginId: "error-test-plugin",
    });

    try {
      // Verify onError can be called with a handler without throwing
      const handler = (_err: Error) => {};
      expect(() => sandboxed.onError(handler)).not.toThrow();
    } finally {
      await sandboxed.terminate();
    }
  });
});
