import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArchiveTools } from "./archive-tools.js";
import type { AgentTool } from "./types.js";

// Mock safeExecSync and node:fs
vi.mock("../security/command-exec.js", () => ({
  safeExecSync: vi.fn(() => ""),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 1024 })),
  };
});

const mockValidatePath = vi.fn();
vi.mock("../security/workspace.js", () => ({
  WorkspaceGuard: vi.fn().mockImplementation(() => ({
    validatePath: mockValidatePath,
  })),
}));

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createArchiveTools", () => {
  it("returns exactly 2 tools", () => {
    const tools = createArchiveTools();
    expect(tools).toHaveLength(2);
  });

  it("returns tools with expected names", () => {
    const tools = createArchiveTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["archive_create", "archive_extract"]);
  });

  it("archive_create has output_path and source_paths parameters", () => {
    const tools = createArchiveTools();
    const tool = getTool(tools, "archive_create");
    const props = tool.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("output_path");
    expect(props).toHaveProperty("source_paths");
    expect(props).toHaveProperty("format");
    expect(tool.parameters.required).toEqual(["output_path", "source_paths"]);
  });

  it("archive_extract has archive_path and output_dir parameters", () => {
    const tools = createArchiveTools();
    const tool = getTool(tools, "archive_extract");
    const props = tool.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("archive_path");
    expect(props).toHaveProperty("output_dir");
    expect(tool.parameters.required).toEqual(["archive_path", "output_dir"]);
  });
});

// ---------------------------------------------------------------------------
// archive_create
// ---------------------------------------------------------------------------

describe("archive_create", () => {
  let tool: AgentTool;
  let mockSafeExecSync: ReturnType<typeof vi.fn>;
  let mockStatSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tool = getTool(createArchiveTools(), "archive_create");
    const commandExec = await import("../security/command-exec.js");
    mockSafeExecSync = commandExec.safeExecSync as ReturnType<typeof vi.fn>;
    mockSafeExecSync.mockClear();
    mockSafeExecSync.mockReturnValue("");

    const fs = await import("node:fs");
    mockStatSync = fs.statSync as ReturnType<typeof vi.fn>;
    mockStatSync.mockClear();
    mockStatSync.mockReturnValue({ size: 2048 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs correct tar command for .tar.gz output", async () => {
    const result = await tool.execute({
      output_path: "/tmp/backup.tar.gz",
      source_paths: ["/home/user/docs", "/home/user/photos"],
    });

    expect(mockSafeExecSync).toHaveBeenCalledWith("tar", [
      "-czf",
      "/tmp/backup.tar.gz",
      "/home/user/docs",
      "/home/user/photos",
    ]);
    expect(result).toContain("Created archive: /tmp/backup.tar.gz");
    expect(result).toContain("2048 bytes");
  });

  it("constructs correct zip command for .zip output", async () => {
    const result = await tool.execute({
      output_path: "/tmp/backup.zip",
      source_paths: ["/home/user/docs"],
    });

    expect(mockSafeExecSync).toHaveBeenCalledWith("zip", [
      "-r",
      "/tmp/backup.zip",
      "/home/user/docs",
    ]);
    expect(result).toContain("Created archive: /tmp/backup.zip");
  });

  it("uses explicit format parameter over extension detection", async () => {
    await tool.execute({
      output_path: "/tmp/archive.bin",
      source_paths: ["/home/user/file.txt"],
      format: "zip",
    });

    expect(mockSafeExecSync).toHaveBeenCalledWith("zip", [
      "-r",
      "/tmp/archive.bin",
      "/home/user/file.txt",
    ]);
  });

  it("detects tar.gz format from .tgz extension", async () => {
    await tool.execute({
      output_path: "/tmp/backup.tgz",
      source_paths: ["/home/user/docs"],
    });

    expect(mockSafeExecSync).toHaveBeenCalledWith("tar", [
      "-czf",
      "/tmp/backup.tgz",
      "/home/user/docs",
    ]);
  });

  it("throws when output_path is missing", async () => {
    await expect(
      tool.execute({ source_paths: ["/tmp/file.txt"] }),
    ).rejects.toThrow("output_path is required");
  });

  it("throws when source_paths is missing", async () => {
    await expect(
      tool.execute({ output_path: "/tmp/out.tar.gz" }),
    ).rejects.toThrow("source_paths is required");
  });

  it("throws when source_paths is empty", async () => {
    await expect(
      tool.execute({ output_path: "/tmp/out.tar.gz", source_paths: [] }),
    ).rejects.toThrow("source_paths is required");
  });

  it("propagates error when command fails", async () => {
    mockSafeExecSync.mockImplementation(() => {
      throw new Error("tar: Cannot open: No such file or directory");
    });

    await expect(
      tool.execute({
        output_path: "/tmp/fail.tar.gz",
        source_paths: ["/nonexistent/path"],
      }),
    ).rejects.toThrow("tar: Cannot open");
  });
});

// ---------------------------------------------------------------------------
// archive_extract
// ---------------------------------------------------------------------------

describe("archive_extract", () => {
  let tool: AgentTool;
  let mockSafeExecSync: ReturnType<typeof vi.fn>;
  let mockExistsSync: ReturnType<typeof vi.fn>;
  let mockMkdirSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tool = getTool(createArchiveTools(), "archive_extract");
    const commandExec = await import("../security/command-exec.js");
    mockSafeExecSync = commandExec.safeExecSync as ReturnType<typeof vi.fn>;
    mockSafeExecSync.mockClear();
    mockSafeExecSync.mockReturnValue("");

    const fs = await import("node:fs");
    mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
    mockExistsSync.mockClear();
    mockExistsSync.mockReturnValue(true);

    mockMkdirSync = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mockMkdirSync.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs correct tar extraction command", async () => {
    const result = await tool.execute({
      archive_path: "/tmp/backup.tar.gz",
      output_dir: "/tmp/output",
    });

    expect(mockSafeExecSync).toHaveBeenCalledWith("tar", [
      "-xzf",
      "/tmp/backup.tar.gz",
      "-C",
      "/tmp/output",
    ]);
    expect(result).toBe("Extracted to /tmp/output");
  });

  it("constructs correct unzip command", async () => {
    const result = await tool.execute({
      archive_path: "/tmp/backup.zip",
      output_dir: "/tmp/output",
    });

    expect(mockSafeExecSync).toHaveBeenCalledWith("unzip", [
      "-o",
      "/tmp/backup.zip",
      "-d",
      "/tmp/output",
    ]);
    expect(result).toBe("Extracted to /tmp/output");
  });

  it("detects tar.gz format from .tgz extension", async () => {
    await tool.execute({
      archive_path: "/tmp/backup.tgz",
      output_dir: "/tmp/output",
    });

    expect(mockSafeExecSync).toHaveBeenCalledWith("tar", [
      "-xzf",
      "/tmp/backup.tgz",
      "-C",
      "/tmp/output",
    ]);
  });

  it("throws when archive_path is missing", async () => {
    await expect(
      tool.execute({ output_dir: "/tmp/output" }),
    ).rejects.toThrow("archive_path is required");
  });

  it("throws when output_dir is missing", async () => {
    await expect(
      tool.execute({ archive_path: "/tmp/archive.zip" }),
    ).rejects.toThrow("output_dir is required");
  });

  it("throws when archive file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(
      tool.execute({
        archive_path: "/tmp/nonexistent.tar.gz",
        output_dir: "/tmp/output",
      }),
    ).rejects.toThrow("Archive not found");
  });

  it("throws for unsupported archive extension", async () => {
    await expect(
      tool.execute({
        archive_path: "/tmp/archive.rar",
        output_dir: "/tmp/output",
      }),
    ).rejects.toThrow("Cannot determine archive format");
  });

  it("propagates error when command fails", async () => {
    mockSafeExecSync.mockImplementation(() => {
      throw new Error("unzip: cannot find or open archive");
    });

    await expect(
      tool.execute({
        archive_path: "/tmp/corrupt.zip",
        output_dir: "/tmp/output",
      }),
    ).rejects.toThrow("unzip: cannot find or open archive");
  });

  it("creates output directory if it does not exist", async () => {
    await tool.execute({
      archive_path: "/tmp/backup.tar.gz",
      output_dir: "/tmp/new-dir/nested",
    });

    expect(mockMkdirSync).toHaveBeenCalledWith("/tmp/new-dir/nested", {
      recursive: true,
    });
  });
});

// ---------------------------------------------------------------------------
// WorkspaceGuard — archive_create
// ---------------------------------------------------------------------------

describe("archive_create WorkspaceGuard", () => {
  let tool: AgentTool;

  beforeEach(async () => {
    mockValidatePath.mockReset();
    const workspace = await import("../security/workspace.js");
    (workspace.WorkspaceGuard as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      validatePath: mockValidatePath,
    }));

    tool = getTool(createArchiveTools(), "archive_create");
    const commandExec = await import("../security/command-exec.js");
    (commandExec.safeExecSync as ReturnType<typeof vi.fn>).mockClear();
    (commandExec.safeExecSync as ReturnType<typeof vi.fn>).mockReturnValue("");

    const fs = await import("node:fs");
    (fs.statSync as ReturnType<typeof vi.fn>).mockClear();
    (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue({ size: 2048 });
  });

  it("validates all paths when __workspace is set", async () => {
    const result = await tool.execute({
      output_path: "/tmp/backup.tar.gz",
      source_paths: ["/tmp/src", "/tmp/docs"],
      __workspace: "/home/user/project",
    });

    expect(mockValidatePath).toHaveBeenCalledTimes(3);
    expect(mockValidatePath).toHaveBeenCalledWith("/tmp/backup.tar.gz");
    expect(mockValidatePath).toHaveBeenCalledWith("/tmp/src");
    expect(mockValidatePath).toHaveBeenCalledWith("/tmp/docs");
    expect(result).toContain("Created archive");
  });

  it("throws when validatePath rejects output_path", async () => {
    mockValidatePath.mockImplementation((p: string) => {
      if (p === "/etc/evil.tar.gz") {
        throw new Error("Path is outside allowed workspace roots: /etc/evil.tar.gz");
      }
    });

    await expect(
      tool.execute({
        output_path: "/etc/evil.tar.gz",
        source_paths: ["/tmp/src"],
        __workspace: "/home/user/project",
      }),
    ).rejects.toThrow("Path is outside allowed workspace roots");
  });

  it("throws when validatePath rejects a source_path", async () => {
    mockValidatePath.mockImplementation((p: string) => {
      if (p === "/var/secret") {
        throw new Error("Path is outside allowed workspace roots: /var/secret");
      }
    });

    await expect(
      tool.execute({
        output_path: "/tmp/backup.tar.gz",
        source_paths: ["/tmp/src", "/var/secret"],
        __workspace: "/home/user/project",
      }),
    ).rejects.toThrow("Path is outside allowed workspace roots");
  });

  it("skips validation when __workspace is not set", async () => {
    const result = await tool.execute({
      output_path: "/var/backup.tar.gz",
      source_paths: ["/var/config"],
    });

    expect(mockValidatePath).not.toHaveBeenCalled();
    expect(result).toContain("Created archive");
  });
});

// ---------------------------------------------------------------------------
// WorkspaceGuard — archive_extract
// ---------------------------------------------------------------------------

describe("archive_extract WorkspaceGuard", () => {
  let tool: AgentTool;

  beforeEach(async () => {
    mockValidatePath.mockReset();
    const workspace = await import("../security/workspace.js");
    (workspace.WorkspaceGuard as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      validatePath: mockValidatePath,
    }));

    tool = getTool(createArchiveTools(), "archive_extract");
    const commandExec = await import("../security/command-exec.js");
    (commandExec.safeExecSync as ReturnType<typeof vi.fn>).mockClear();
    (commandExec.safeExecSync as ReturnType<typeof vi.fn>).mockReturnValue("");

    const fs = await import("node:fs");
    (fs.existsSync as ReturnType<typeof vi.fn>).mockClear();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.mkdirSync as ReturnType<typeof vi.fn>).mockClear();
  });

  it("validates both paths when __workspace is set", async () => {
    const result = await tool.execute({
      archive_path: "/tmp/backup.tar.gz",
      output_dir: "/tmp/output",
      __workspace: "/home/user/project",
    });

    expect(mockValidatePath).toHaveBeenCalledTimes(2);
    expect(mockValidatePath).toHaveBeenCalledWith("/tmp/backup.tar.gz");
    expect(mockValidatePath).toHaveBeenCalledWith("/tmp/output");
    expect(result).toBe("Extracted to /tmp/output");
  });

  it("throws when validatePath rejects archive_path", async () => {
    mockValidatePath.mockImplementation((p: string) => {
      if (p === "/var/evil.tar.gz") {
        throw new Error("Path is outside allowed workspace roots: /var/evil.tar.gz");
      }
    });

    await expect(
      tool.execute({
        archive_path: "/var/evil.tar.gz",
        output_dir: "/tmp/output",
        __workspace: "/home/user/project",
      }),
    ).rejects.toThrow("Path is outside allowed workspace roots");
  });

  it("throws when validatePath rejects output_dir", async () => {
    mockValidatePath.mockImplementation((p: string) => {
      if (p === "/var/output") {
        throw new Error("Path is outside allowed workspace roots: /var/output");
      }
    });

    await expect(
      tool.execute({
        archive_path: "/tmp/backup.tar.gz",
        output_dir: "/var/output",
        __workspace: "/home/user/project",
      }),
    ).rejects.toThrow("Path is outside allowed workspace roots");
  });

  it("skips validation when __workspace is not set", async () => {
    const result = await tool.execute({
      archive_path: "/var/backup.tar.gz",
      output_dir: "/var/output",
    });

    expect(mockValidatePath).not.toHaveBeenCalled();
    expect(result).toBe("Extracted to /var/output");
  });
});
