import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTool } from "./types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:os", () => ({
  hostname: vi.fn(() => "test-host"),
  platform: vi.fn(() => "linux"),
  arch: vi.fn(() => "x64"),
  cpus: vi.fn(() => [
    { model: "Intel Core i7-9700K", speed: 3600, times: {} },
    { model: "Intel Core i7-9700K", speed: 3600, times: {} },
    { model: "Intel Core i7-9700K", speed: 3600, times: {} },
    { model: "Intel Core i7-9700K", speed: 3600, times: {} },
    { model: "Intel Core i7-9700K", speed: 3600, times: {} },
    { model: "Intel Core i7-9700K", speed: 3600, times: {} },
    { model: "Intel Core i7-9700K", speed: 3600, times: {} },
    { model: "Intel Core i7-9700K", speed: 3600, times: {} },
  ]),
  totalmem: vi.fn(() => 16 * 1024 * 1024 * 1024), // 16 GB
  freemem: vi.fn(() => 12 * 1024 * 1024 * 1024), // 12 GB free => 4 GB used
  uptime: vi.fn(() => 3 * 86400 + 14 * 3600 + 22 * 60), // 3d 14h 22m
}));

vi.mock("../security/command-exec.js", () => ({
  safeExecSync: vi.fn(() => ""),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => ""),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSystemTools", () => {
  // We need to import after mocks are set up
  let createSystemTools: typeof import("./system-tools.js").createSystemTools;
  let safeExecSync: ReturnType<typeof vi.fn>;
  let execFileSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("./system-tools.js");
    createSystemTools = mod.createSystemTools;
    const cmdExec = await import("../security/command-exec.js");
    safeExecSync = cmdExec.safeExecSync as ReturnType<typeof vi.fn>;
    const cp = await import("node:child_process");
    execFileSync = cp.execFileSync as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns exactly 5 tools", () => {
    const tools = createSystemTools();
    expect(tools).toHaveLength(5);
  });

  it("returns tools with expected names", () => {
    const tools = createSystemTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "clipboard_read",
      "clipboard_write",
      "notify",
      "screenshot",
      "system_info",
    ]);
  });

  // -------------------------------------------------------------------------
  // system_info
  // -------------------------------------------------------------------------

  describe("system_info", () => {
    it("returns formatted text with hostname, OS, CPU, memory, uptime", async () => {
      const tools = createSystemTools();
      const sysInfo = getTool(tools, "system_info");
      const result = await sysInfo.execute({});

      expect(result).toContain("System Information:");
      expect(result).toContain("Hostname: test-host");
      expect(result).toContain("OS: linux x64");
      expect(result).toContain("8 \u00d7 Intel Core i7-9700K @ 3.60GHz");
      expect(result).toContain("Memory:");
      expect(result).toContain("16.0 GB");
      expect(result).toContain("25% used");
      expect(result).toContain("Uptime: 3d 14h 22m");
    });

    it("has allow default policy", () => {
      const tools = createSystemTools();
      const sysInfo = tools.find((t) => t.name === "system_info");
      expect(sysInfo?.defaultPolicy).toBe("allow");
    });
  });

  // -------------------------------------------------------------------------
  // clipboard_read
  // -------------------------------------------------------------------------

  describe("clipboard_read", () => {
    it("calls pbpaste on macOS", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      safeExecSync.mockReturnValue("clipboard content");

      const tools = createSystemTools();
      const clipRead = getTool(tools, "clipboard_read");
      const result = await clipRead.execute({});

      expect(safeExecSync).toHaveBeenCalledWith("pbpaste", []);
      expect(result).toBe("clipboard content");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("calls xclip on Linux", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });

      safeExecSync.mockReturnValue("linux clipboard");

      const tools = createSystemTools();
      const clipRead = getTool(tools, "clipboard_read");
      const result = await clipRead.execute({});

      expect(safeExecSync).toHaveBeenCalledWith("xclip", [
        "-selection",
        "clipboard",
        "-o",
      ]);
      expect(result).toBe("linux clipboard");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("falls back to xsel on Linux when xclip fails", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });

      safeExecSync
        .mockImplementationOnce(() => {
          throw new Error("xclip not found");
        })
        .mockReturnValueOnce("xsel clipboard");

      const tools = createSystemTools();
      const clipRead = getTool(tools, "clipboard_read");
      const result = await clipRead.execute({});

      expect(safeExecSync).toHaveBeenCalledTimes(2);
      expect(safeExecSync).toHaveBeenCalledWith("xsel", [
        "--clipboard",
        "--output",
      ]);
      expect(result).toBe("xsel clipboard");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("calls powershell on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", writable: true });

      safeExecSync.mockReturnValue("windows clipboard");

      const tools = createSystemTools();
      const clipRead = getTool(tools, "clipboard_read");
      const result = await clipRead.execute({});

      expect(safeExecSync).toHaveBeenCalledWith("powershell.exe", [
        "-Command",
        "Get-Clipboard",
      ]);
      expect(result).toBe("windows clipboard");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("truncates text longer than 16000 chars", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      const longText = "x".repeat(20_000);
      safeExecSync.mockReturnValue(longText);

      const tools = createSystemTools();
      const clipRead = getTool(tools, "clipboard_read");
      const result = await clipRead.execute({});

      expect(result).toContain("[Truncated");
      expect(result).toContain("20000 chars total");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("has confirm default policy", () => {
      const tools = createSystemTools();
      const clipRead = tools.find((t) => t.name === "clipboard_read");
      expect(clipRead?.defaultPolicy).toBe("confirm");
    });

    it("throws on command failure", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      safeExecSync.mockImplementation(() => {
        throw new Error("command failed");
      });

      const tools = createSystemTools();
      const clipRead = getTool(tools, "clipboard_read");
      await expect(clipRead.execute({})).rejects.toThrow(
        "Failed to read clipboard: command failed",
      );

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });
  });

  // -------------------------------------------------------------------------
  // clipboard_write
  // -------------------------------------------------------------------------

  describe("clipboard_write", () => {
    it("pipes text to pbcopy on macOS", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      const tools = createSystemTools();
      const clipWrite = getTool(tools, "clipboard_write");
      const result = await clipWrite.execute({ text: "hello world" });

      expect(execFileSync).toHaveBeenCalledWith("pbcopy", [], {
        input: "hello world",
        shell: false,
      });
      expect(result).toBe("Copied 11 characters to clipboard");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("pipes text to xclip on Linux", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });

      const tools = createSystemTools();
      const clipWrite = getTool(tools, "clipboard_write");
      const result = await clipWrite.execute({ text: "linux text" });

      expect(execFileSync).toHaveBeenCalledWith(
        "xclip",
        ["-selection", "clipboard"],
        { input: "linux text", shell: false },
      );
      expect(result).toBe("Copied 10 characters to clipboard");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("pipes text to powershell on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", writable: true });

      const tools = createSystemTools();
      const clipWrite = getTool(tools, "clipboard_write");
      const result = await clipWrite.execute({ text: "win text" });

      expect(execFileSync).toHaveBeenCalledWith(
        "powershell.exe",
        ["-Command", "Set-Clipboard"],
        { input: "win text", shell: false },
      );
      expect(result).toBe("Copied 8 characters to clipboard");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("throws when text parameter is missing", async () => {
      const tools = createSystemTools();
      const clipWrite = getTool(tools, "clipboard_write");
      await expect(clipWrite.execute({})).rejects.toThrow("text is required");
    });

    it("handles empty string correctly", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      const tools = createSystemTools();
      const clipWrite = getTool(tools, "clipboard_write");
      const result = await clipWrite.execute({ text: "" });

      expect(execFileSync).toHaveBeenCalled();
      expect(result).toBe("Copied 0 characters to clipboard");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("throws on command failure", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      execFileSync.mockImplementation(() => {
        throw new Error("pbcopy failed");
      });

      const tools = createSystemTools();
      const clipWrite = getTool(tools, "clipboard_write");
      await expect(clipWrite.execute({ text: "test" })).rejects.toThrow(
        "Failed to write to clipboard: pbcopy failed",
      );

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("has confirm default policy", () => {
      const tools = createSystemTools();
      const clipWrite = tools.find((t) => t.name === "clipboard_write");
      expect(clipWrite?.defaultPolicy).toBe("confirm");
    });
  });

  // -------------------------------------------------------------------------
  // screenshot
  // -------------------------------------------------------------------------

  describe("screenshot", () => {
    it("calls screencapture on macOS", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      const tools = createSystemTools();
      const ss = getTool(tools, "screenshot");
      const result = await ss.execute({ output_path: "/tmp/test-shot.png" });

      expect(safeExecSync).toHaveBeenCalledWith("screencapture", [
        "-x",
        "/tmp/test-shot.png",
      ]);
      expect(result).toBe("Screenshot saved to /tmp/test-shot.png");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("calls scrot on Linux", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });

      const tools = createSystemTools();
      const ss = getTool(tools, "screenshot");
      const result = await ss.execute({ output_path: "/tmp/linux-shot.png" });

      expect(safeExecSync).toHaveBeenCalledWith("scrot", [
        "/tmp/linux-shot.png",
      ]);
      expect(result).toBe("Screenshot saved to /tmp/linux-shot.png");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("falls back to gnome-screenshot on Linux when scrot fails", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });

      safeExecSync
        .mockImplementationOnce(() => {
          throw new Error("scrot not found");
        })
        .mockReturnValueOnce("");

      const tools = createSystemTools();
      const ss = getTool(tools, "screenshot");
      const result = await ss.execute({ output_path: "/tmp/gnome-shot.png" });

      expect(safeExecSync).toHaveBeenCalledTimes(2);
      expect(safeExecSync).toHaveBeenCalledWith("gnome-screenshot", [
        "-f",
        "/tmp/gnome-shot.png",
      ]);
      expect(result).toBe("Screenshot saved to /tmp/gnome-shot.png");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("uses PowerShell EncodedCommand on Windows with env var for path", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", writable: true });

      const tools = createSystemTools();
      const ss = getTool(tools, "screenshot");
      const result = await ss.execute({ output_path: "C:\\tmp\\shot.png" });

      expect(execFileSync).toHaveBeenCalledWith(
        "powershell.exe",
        ["-EncodedCommand", expect.any(String)],
        { shell: false, env: expect.objectContaining({ HAYA_SCREENSHOT_PATH: "C:\\tmp\\shot.png" }) },
      );
      // Verify the encoded script does NOT contain the output path directly
      const encodedScript = execFileSync.mock.calls[0][1][1];
      const decodedScript = Buffer.from(encodedScript, "base64").toString("utf16le");
      expect(decodedScript).toContain("$env:HAYA_SCREENSHOT_PATH");
      expect(decodedScript).not.toContain("C:\\tmp\\shot.png");
      expect(result).toBe("Screenshot saved to C:\\tmp\\shot.png");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("generates default output path when not provided", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      const tools = createSystemTools();
      const ss = getTool(tools, "screenshot");
      const result = await ss.execute({});

      expect(result).toMatch(/Screenshot saved to \/tmp\/haya-screenshot-\d+\.png/);

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("throws on command failure", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      safeExecSync.mockImplementation(() => {
        throw new Error("screencapture failed");
      });

      const tools = createSystemTools();
      const ss = getTool(tools, "screenshot");
      await expect(ss.execute({ output_path: "/tmp/fail.png" })).rejects.toThrow(
        "Failed to capture screenshot: screencapture failed",
      );

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("has confirm default policy", () => {
      const tools = createSystemTools();
      const ss = tools.find((t) => t.name === "screenshot");
      expect(ss?.defaultPolicy).toBe("confirm");
    });
  });

  // -------------------------------------------------------------------------
  // notify
  // -------------------------------------------------------------------------

  describe("notify", () => {
    it("calls osascript on macOS", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      const tools = createSystemTools();
      const notifyTool = getTool(tools, "notify");
      const result = await notifyTool.execute({
        title: "Test Title",
        message: "Test Message",
      });

      expect(safeExecSync).toHaveBeenCalledWith("osascript", [
        "-e",
        'display notification "Test Message" with title "Test Title"',
      ]);
      expect(result).toBe("Notification sent: Test Title");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("calls notify-send on Linux", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });

      const tools = createSystemTools();
      const notifyTool = getTool(tools, "notify");
      const result = await notifyTool.execute({
        title: "Linux Title",
        message: "Linux Message",
      });

      expect(safeExecSync).toHaveBeenCalledWith("notify-send", [
        "Linux Title",
        "Linux Message",
      ]);
      expect(result).toBe("Notification sent: Linux Title");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("uses PowerShell toast notification on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", writable: true });

      const tools = createSystemTools();
      const notifyTool = getTool(tools, "notify");
      const result = await notifyTool.execute({
        title: "Win Title",
        message: "Win Message",
      });

      expect(execFileSync).toHaveBeenCalledWith(
        "powershell.exe",
        ["-Command", expect.stringContaining("ShowBalloonTip")],
        { shell: false },
      );
      expect(result).toBe("Notification sent: Win Title");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("escapes double quotes in title and message on macOS", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      const tools = createSystemTools();
      const notifyTool = getTool(tools, "notify");
      await notifyTool.execute({
        title: 'Say "hello"',
        message: 'He said "goodbye"',
      });

      expect(safeExecSync).toHaveBeenCalledWith("osascript", [
        "-e",
        'display notification "He said \\"goodbye\\"" with title "Say \\"hello\\""',
      ]);

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("escapes backslashes in title and message on macOS", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      const tools = createSystemTools();
      const notifyTool = getTool(tools, "notify");
      await notifyTool.execute({
        title: "path\\to\\file",
        message: "C:\\Users\\test",
      });

      expect(safeExecSync).toHaveBeenCalledWith("osascript", [
        "-e",
        'display notification "C:\\\\Users\\\\test" with title "path\\\\to\\\\file"',
      ]);

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("throws when title is missing", async () => {
      const tools = createSystemTools();
      const notifyTool = getTool(tools, "notify");
      await expect(
        notifyTool.execute({ message: "test" }),
      ).rejects.toThrow("title is required");
    });

    it("throws when message is missing", async () => {
      const tools = createSystemTools();
      const notifyTool = getTool(tools, "notify");
      await expect(
        notifyTool.execute({ title: "test" }),
      ).rejects.toThrow("message is required");
    });

    it("throws on command failure", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });

      safeExecSync.mockImplementation(() => {
        throw new Error("notify-send not found");
      });

      const tools = createSystemTools();
      const notifyTool = getTool(tools, "notify");
      await expect(
        notifyTool.execute({ title: "Test", message: "Msg" }),
      ).rejects.toThrow("Failed to send notification: notify-send not found");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("has allow default policy", () => {
      const tools = createSystemTools();
      const notifyTool = tools.find((t) => t.name === "notify");
      expect(notifyTool?.defaultPolicy).toBe("allow");
    });
  });
});
