import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQrTools } from "./qr-tools.js";
import type { AgentTool } from "./types.js";

vi.mock("../security/command-exec.js", () => ({
  safeExecSync: vi.fn().mockReturnValue(""),
}));

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createQrTools", () => {
  it("returns 2 tools", () => {
    const tools = createQrTools();
    expect(tools).toHaveLength(2);
  });

  it("returns tools with expected names", () => {
    const tools = createQrTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["qr_decode", "qr_generate"]);
  });

  it("qr_generate has defaultPolicy allow", () => {
    const tools = createQrTools();
    const tool = getTool(tools, "qr_generate");
    expect(
      (tool as AgentTool & { defaultPolicy: string }).defaultPolicy,
    ).toBe("allow");
  });

  it("qr_decode has defaultPolicy allow", () => {
    const tools = createQrTools();
    const tool = getTool(tools, "qr_decode");
    expect(
      (tool as AgentTool & { defaultPolicy: string }).defaultPolicy,
    ).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// qr_generate
// ---------------------------------------------------------------------------

describe("qr_generate", () => {
  let tool: AgentTool;

  beforeEach(() => {
    tool = getTool(createQrTools(), "qr_generate");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls qrencode with correct arguments", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");

    const result = await tool.execute({
      text: "https://example.com",
      output_path: "/tmp/test-qr.png",
    });

    expect(safeExecSync).toHaveBeenCalledWith("qrencode", [
      "-o",
      "/tmp/test-qr.png",
      "-t",
      "PNG",
      "https://example.com",
    ]);
    expect(result).toContain("QR code saved to /tmp/test-qr.png");
  });

  it("uses default output path when not provided", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");

    const result = await tool.execute({ text: "hello" });

    const callArgs = (safeExecSync as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string[]];
    const outputPath = callArgs[1][1]; // -o <path>
    expect(outputPath).toMatch(/^\/tmp\/haya-qr-\d+\.png$/);
    expect(result).toContain("QR code saved to");
  });

  it("uses custom output path when provided", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");

    await tool.execute({
      text: "test",
      output_path: "/home/user/my-qr.png",
    });

    expect(safeExecSync).toHaveBeenCalledWith("qrencode", [
      "-o",
      "/home/user/my-qr.png",
      "-t",
      "PNG",
      "test",
    ]);
  });

  it("throws when qrencode is not installed", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");
    (safeExecSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("ENOENT: qrencode not found");
    });

    await expect(
      tool.execute({ text: "hello" }),
    ).rejects.toThrow("qrencode is not installed");
  });

  it("throws when text is missing", async () => {
    await expect(tool.execute({})).rejects.toThrow("text is required");
  });

  it("throws on other qrencode errors", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");
    (safeExecSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Permission denied");
    });

    await expect(
      tool.execute({ text: "hello" }),
    ).rejects.toThrow("Failed to generate QR code");
  });
});

// ---------------------------------------------------------------------------
// qr_decode
// ---------------------------------------------------------------------------

describe("qr_decode", () => {
  let tool: AgentTool;

  beforeEach(() => {
    tool = getTool(createQrTools(), "qr_decode");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls zbarimg with correct arguments", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");
    (safeExecSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      "https://example.com\n",
    );

    const result = await tool.execute({ image_path: "/tmp/qr.png" });

    expect(safeExecSync).toHaveBeenCalledWith("zbarimg", [
      "--quiet",
      "--raw",
      "/tmp/qr.png",
    ]);
    expect(result).toBe("https://example.com");
  });

  it("trims whitespace from decoded output", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");
    (safeExecSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      "  decoded text  \n",
    );

    const result = await tool.execute({ image_path: "/tmp/qr.png" });
    expect(result).toBe("decoded text");
  });

  it("throws when zbarimg is not installed", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");
    (safeExecSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("ENOENT: zbarimg not found");
    });

    await expect(
      tool.execute({ image_path: "/tmp/qr.png" }),
    ).rejects.toThrow("zbarimg is not installed");
  });

  it("throws when image_path is missing", async () => {
    await expect(tool.execute({})).rejects.toThrow("image_path is required");
  });

  it("throws on other zbarimg errors", async () => {
    const { safeExecSync } = await import("../security/command-exec.js");
    (safeExecSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Invalid image format");
    });

    await expect(
      tool.execute({ image_path: "/tmp/bad.png" }),
    ).rejects.toThrow("Failed to decode QR code");
  });
});
