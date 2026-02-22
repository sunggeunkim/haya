import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  webFetchTool,
  shellExecTool,
  fileReadTool,
  fileWriteTool,
  fileListTool,
  builtinTools,
  createSessionTools,
  defaultToolPolicies,
} from "./builtin-tools.js";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("builtin-tools", () => {
  describe("webFetchTool", () => {
    it("has correct name and default policy", () => {
      expect(webFetchTool.name).toBe("web_fetch");
      expect(webFetchTool.defaultPolicy).toBe("allow");
    });

    it("rejects missing url", async () => {
      await expect(webFetchTool.execute({})).rejects.toThrow("url is required");
    });

    it("rejects invalid url", async () => {
      await expect(webFetchTool.execute({ url: "not-a-url" })).rejects.toThrow("Invalid URL");
    });

    it("rejects unsupported protocol", async () => {
      await expect(webFetchTool.execute({ url: "ftp://example.com" })).rejects.toThrow("Unsupported protocol");
    });
  });

  describe("shellExecTool", () => {
    it("has correct name and default policy", () => {
      expect(shellExecTool.name).toBe("shell_exec");
      expect(shellExecTool.defaultPolicy).toBe("confirm");
    });

    it("rejects missing command", async () => {
      await expect(shellExecTool.execute({})).rejects.toThrow("command is required");
    });

    it("executes a simple command", async () => {
      const result = await shellExecTool.execute({ command: "echo", args: ["hello"] });
      expect(result.trim()).toBe("hello");
    });
  });

  describe("fileReadTool", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "haya-test-read-"));
    });

    it("has correct name and default policy", () => {
      expect(fileReadTool.name).toBe("file_read");
      expect(fileReadTool.defaultPolicy).toBe("allow");
    });

    it("reads a file", async () => {
      const testFile = join(tmpDir, "test.txt");
      writeFileSync(testFile, "hello world");
      const result = await fileReadTool.execute({ path: testFile });
      expect(result).toBe("hello world");
    });

    it("rejects missing path", async () => {
      await expect(fileReadTool.execute({})).rejects.toThrow("path is required");
    });
  });

  describe("fileWriteTool", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "haya-test-write-"));
    });

    it("has correct name and default policy", () => {
      expect(fileWriteTool.name).toBe("file_write");
      expect(fileWriteTool.defaultPolicy).toBe("confirm");
    });

    it("writes a file", async () => {
      const testFile = join(tmpDir, "output.txt");
      const result = await fileWriteTool.execute({ path: testFile, content: "test content" });
      expect(result).toContain("12 bytes");
      expect(readFileSync(testFile, "utf-8")).toBe("test content");
    });

    it("rejects missing path", async () => {
      await expect(fileWriteTool.execute({ content: "x" })).rejects.toThrow("path is required");
    });
  });

  describe("fileListTool", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "haya-test-list-"));
      writeFileSync(join(tmpDir, "a.txt"), "aaa");
      mkdirSync(join(tmpDir, "subdir"));
    });

    it("has correct name and default policy", () => {
      expect(fileListTool.name).toBe("file_list");
      expect(fileListTool.defaultPolicy).toBe("allow");
    });

    it("lists files and directories", async () => {
      const result = await fileListTool.execute({ path: tmpDir });
      expect(result).toContain("a.txt");
      expect(result).toContain("subdir");
      expect(result).toContain("file");
      expect(result).toContain("dir");
    });
  });

  describe("createSessionTools", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "haya-test-sessions-"));
    });

    it("creates two tools", () => {
      const tools = createSessionTools(tmpDir);
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("sessions_send");
      expect(tools[1].name).toBe("sessions_history");
    });

    it("sessions_send creates session and appends message", async () => {
      const tools = createSessionTools(tmpDir);
      const sendTool = tools[0];
      const result = await sendTool.execute({
        targetSessionId: "test-session",
        message: "hello from another session",
      });
      expect(result).toContain("test-session");

      // Verify the session file was created
      expect(existsSync(join(tmpDir, "test-session.jsonl"))).toBe(true);
    });

    it("sessions_history reads session messages", async () => {
      const tools = createSessionTools(tmpDir);
      const sendTool = tools[0];
      const historyTool = tools[1];

      await sendTool.execute({
        targetSessionId: "test-history",
        message: "first message",
      });
      await sendTool.execute({
        targetSessionId: "test-history",
        message: "second message",
      });

      const result = await historyTool.execute({ targetSessionId: "test-history" });
      expect(result).toContain("first message");
      expect(result).toContain("second message");
    });

    it("sessions_history returns not found for missing session", async () => {
      const tools = createSessionTools(tmpDir);
      const historyTool = tools[1];
      const result = await historyTool.execute({ targetSessionId: "nonexistent" });
      expect(result).toContain("not found");
    });
  });

  describe("builtinTools array", () => {
    it("contains all standard tools", () => {
      const names = builtinTools.map((t) => t.name);
      expect(names).toContain("web_fetch");
      expect(names).toContain("shell_exec");
      expect(names).toContain("file_read");
      expect(names).toContain("file_write");
      expect(names).toContain("file_list");
      expect(names).toContain("browser_action");
    });

    it("has 6 tools", () => {
      expect(builtinTools).toHaveLength(6);
    });
  });

  describe("defaultToolPolicies", () => {
    it("has policies for all builtin tools", () => {
      const policyNames = defaultToolPolicies.map((p) => p.toolName);
      expect(policyNames).toContain("web_fetch");
      expect(policyNames).toContain("shell_exec");
      expect(policyNames).toContain("file_read");
      expect(policyNames).toContain("file_write");
      expect(policyNames).toContain("file_list");
      expect(policyNames).toContain("browser_action");
      expect(policyNames).toContain("sessions_send");
      expect(policyNames).toContain("sessions_history");
    });

    it("marks dangerous tools as confirm", () => {
      const shellPolicy = defaultToolPolicies.find((p) => p.toolName === "shell_exec");
      expect(shellPolicy?.level).toBe("confirm");
      const writePolicy = defaultToolPolicies.find((p) => p.toolName === "file_write");
      expect(writePolicy?.level).toBe("confirm");
    });

    it("marks safe tools as allow", () => {
      const readPolicy = defaultToolPolicies.find((p) => p.toolName === "file_read");
      expect(readPolicy?.level).toBe("allow");
      const fetchPolicy = defaultToolPolicies.find((p) => p.toolName === "web_fetch");
      expect(fetchPolicy?.level).toBe("allow");
    });
  });
});
