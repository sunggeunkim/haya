import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceGuard, WorkspaceViolationError } from "./workspace.js";

describe("WorkspaceGuard", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "ws-guard-"));
    mkdirSync(join(rootDir, "sub"), { recursive: true });
    writeFileSync(join(rootDir, "sub", "file.txt"), "hello");
  });

  it("allows paths within roots", () => {
    const guard = new WorkspaceGuard([rootDir]);
    const result = guard.validatePath(join(rootDir, "sub", "file.txt"));
    expect(result).toContain(rootDir);
  });

  it("allows the root path itself", () => {
    const guard = new WorkspaceGuard([rootDir]);
    const result = guard.validatePath(rootDir);
    expect(result).toBe(rootDir);
  });

  it("blocks paths outside roots", () => {
    const guard = new WorkspaceGuard([rootDir]);
    expect(() => guard.validatePath("/etc/passwd")).toThrow(
      WorkspaceViolationError,
    );
  });

  it("blocks path traversal attempts", () => {
    const guard = new WorkspaceGuard([rootDir]);
    const malicious = join(rootDir, "..", "..", "..", "etc", "passwd");
    expect(() => guard.validatePath(malicious)).toThrow(
      WorkspaceViolationError,
    );
  });

  it("handles symlinks correctly", () => {
    const targetDir = mkdtempSync(join(tmpdir(), "ws-target-"));
    writeFileSync(join(targetDir, "secret.txt"), "secret");
    const linkPath = join(rootDir, "link");
    symlinkSync(targetDir, linkPath);

    // rootDir is allowed, but following the symlink leads outside it
    const guard = new WorkspaceGuard([rootDir]);
    // The symlink target is outside rootDir, so it should be blocked
    expect(() =>
      guard.validatePath(join(rootDir, "link", "secret.txt")),
    ).toThrow(WorkspaceViolationError);
  });

  it("allows symlink targets when the target root is also allowed", () => {
    const targetDir = mkdtempSync(join(tmpdir(), "ws-target-"));
    writeFileSync(join(targetDir, "ok.txt"), "ok");
    const linkPath = join(rootDir, "link");
    symlinkSync(targetDir, linkPath);

    const guard = new WorkspaceGuard([rootDir, targetDir]);
    const result = guard.validatePath(join(rootDir, "link", "ok.txt"));
    expect(result).toContain("ok.txt");
  });

  describe("isAllowed", () => {
    it("returns true for paths within roots", () => {
      const guard = new WorkspaceGuard([rootDir]);
      expect(guard.isAllowed(join(rootDir, "sub", "file.txt"))).toBe(true);
    });

    it("returns false for paths outside roots", () => {
      const guard = new WorkspaceGuard([rootDir]);
      expect(guard.isAllowed("/etc/passwd")).toBe(false);
    });

    it("returns false for traversal paths", () => {
      const guard = new WorkspaceGuard([rootDir]);
      expect(
        guard.isAllowed(join(rootDir, "..", "..", "etc", "passwd")),
      ).toBe(false);
    });
  });

  describe("WorkspaceViolationError", () => {
    it("has the correct name", () => {
      const err = new WorkspaceViolationError("/bad/path");
      expect(err.name).toBe("WorkspaceViolationError");
    });

    it("has the path property", () => {
      const err = new WorkspaceViolationError("/bad/path");
      expect(err.path).toBe("/bad/path");
    });

    it("is an instance of Error", () => {
      const err = new WorkspaceViolationError("/bad/path");
      expect(err).toBeInstanceOf(Error);
    });

    it("includes the path in the message", () => {
      const err = new WorkspaceViolationError("/bad/path");
      expect(err.message).toContain("/bad/path");
    });
  });

  describe("getRoots", () => {
    it("returns the resolved roots", () => {
      const guard = new WorkspaceGuard([rootDir]);
      const roots = guard.getRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBe(rootDir);
    });

    it("returns a read-only array", () => {
      const guard = new WorkspaceGuard([rootDir]);
      const roots = guard.getRoots();
      expect(Array.isArray(roots)).toBe(true);
    });
  });

  it("handles non-existent root directories gracefully", () => {
    const nonExistent = join(rootDir, "does-not-exist");
    // Should not throw during construction
    const guard = new WorkspaceGuard([nonExistent]);
    expect(guard.getRoots()).toHaveLength(1);
  });
});
