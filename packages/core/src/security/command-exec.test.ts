import { describe, expect, it } from "vitest";
import { safeExecSync } from "./command-exec.js";

describe("safeExecSync", () => {
  it("executes a simple command", () => {
    const result = safeExecSync("echo", ["hello"]);
    expect(result.trim()).toBe("hello");
  });

  it("passes arguments safely without shell interpretation", () => {
    // Characters that would be dangerous in a shell context
    const result = safeExecSync("echo", ["hello; rm -rf /"]);
    expect(result.trim()).toBe("hello; rm -rf /");
  });

  it("handles multiple arguments", () => {
    const result = safeExecSync("echo", ["arg1", "arg2", "arg3"]);
    expect(result.trim()).toBe("arg1 arg2 arg3");
  });

  it("handles arguments with spaces", () => {
    const result = safeExecSync("echo", ["hello world"]);
    expect(result.trim()).toBe("hello world");
  });

  it("handles arguments with special characters", () => {
    const result = safeExecSync("echo", ["$HOME", "`whoami`", "$(id)"]);
    // With shell:false, these are treated as literal strings
    expect(result.trim()).toBe("$HOME `whoami` $(id)");
  });

  it("rejects empty command", () => {
    expect(() => safeExecSync("", ["arg"])).toThrow(/must not be empty/);
  });

  it("rejects null bytes in command", () => {
    expect(() => safeExecSync("echo\0bad", ["arg"])).toThrow(
      /must not contain null bytes/,
    );
  });

  it("rejects null bytes in arguments", () => {
    expect(() => safeExecSync("echo", ["good", "bad\0arg"])).toThrow(
      /must not contain null bytes/,
    );
  });

  it("respects timeout option", () => {
    expect(() =>
      safeExecSync("sleep", ["10"], { timeout: 100 }),
    ).toThrow();
  });

  it("supports cwd option", () => {
    const result = safeExecSync("pwd", [], { cwd: "/tmp" });
    expect(result.trim()).toBe("/tmp");
  });
});
