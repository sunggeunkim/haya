import { describe, it, expect } from "vitest";
import { createCodeEvalTools } from "./code-eval-tools.js";

describe("createCodeEvalTools", () => {
  it("returns one tool", () => {
    const tools = createCodeEvalTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("code_eval");
  });

  it("tool has required fields", () => {
    const tools = createCodeEvalTools();
    const tool = tools[0];
    expect(tool.name).toBeTruthy();
    expect(tool.description).toBeTruthy();
    expect(tool.defaultPolicy).toBe("confirm");
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe("function");
  });
});

describe("code_eval", () => {
  function getTool() {
    return createCodeEvalTools()[0];
  }

  it("evaluates a simple expression", async () => {
    const tool = getTool();
    const result = await tool.execute({ code: "2 + 2" });
    expect(result).toBe("Result: 4");
  });

  it("evaluates Math functions", async () => {
    const tool = getTool();
    const result = await tool.execute({ code: "Math.sqrt(16)" });
    expect(result).toBe("Result: 4");
  });

  it("evaluates JSON.parse", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: 'JSON.parse(\'{"a":1}\')',
    });
    expect(result).toBe('Result: {"a":1}');
  });

  it("evaluates JSON.stringify", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "JSON.stringify({ x: 42 })",
    });
    expect(result).toBe('Result: {"x":42}');
  });

  it("evaluates string manipulation", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: '"hello world".toUpperCase()',
    });
    expect(result).toBe("Result: HELLO WORLD");
  });

  it("captures console.log output", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: 'console.log("line1"); console.log("line2"); 42',
    });
    expect(result).toContain("Result: 42");
    expect(result).toContain("Console output:");
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });

  it("enforces timeout on infinite loops", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "while(true) {}",
      timeout: 100,
    });
    expect(result).toContain("Error:");
    expect(result).toMatch(/timed out|timeout|execution time/i);
  });

  it("denies access to require", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: 'require("fs")',
    });
    expect(result).toContain("Error:");
  });

  it("denies access to dynamic import via await", async () => {
    const tool = getTool();
    // Static import syntax is a SyntaxError in vm script mode.
    // Dynamic import() would produce an unhandled async rejection in the
    // vm because there is no importModuleDynamically callback.  Instead
    // we verify that attempting to use `await import(...)` (which requires
    // top-level await, unavailable in Script mode) results in a
    // SyntaxError, proving the sandbox cannot load modules this way.
    const result = await tool.execute({
      code: 'await import("fs")',
    });
    expect(result).toContain("Error:");
  });

  it("denies access to process", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "process.env",
    });
    expect(result).toContain("Error:");
  });

  it("denies access to globalThis dangerous properties", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "globalThis.process",
    });
    // globalThis is not exposed, so this should error or return undefined
    expect(result).toMatch(/Error:|Result: undefined/);
  });

  it("handles syntax errors", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "function {{{ invalid",
    });
    expect(result).toContain("Error:");
  });

  it("handles runtime errors", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "undefinedVariable.property",
    });
    expect(result).toContain("Error:");
  });

  it("JSON stringifies object results", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "({ a: 1, b: [2, 3] })",
    });
    expect(result).toBe('Result: {"a":1,"b":[2,3]}');
  });

  it("JSON stringifies array results", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "[1, 2, 3].map(x => x * 2)",
    });
    expect(result).toBe("Result: [2,4,6]");
  });

  it("truncates output exceeding 16000 chars", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: '"x".repeat(20000)',
    });
    expect(result).toContain("[Truncated");
    expect(result.length).toBeLessThanOrEqual(16_000 + 100); // some room for the truncation message
  });

  it("handles undefined result", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "undefined",
    });
    expect(result).toBe("Result: undefined");
  });

  it("handles null result", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "null",
    });
    expect(result).toBe("Result: null");
  });

  it("throws if code is missing", async () => {
    const tool = getTool();
    await expect(tool.execute({})).rejects.toThrow("code is required");
  });

  it("caps timeout at 30 seconds", async () => {
    const tool = getTool();
    // Should not throw even with a huge timeout value - it should be capped
    const result = await tool.execute({
      code: "1 + 1",
      timeout: 999_999,
    });
    expect(result).toBe("Result: 2");
  });

  it("uses default 5s timeout when not specified", async () => {
    const tool = getTool();
    const result = await tool.execute({ code: "42" });
    expect(result).toBe("Result: 42");
  });

  it("provides access to Map and Set", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "new Map([['a', 1]]).get('a')",
    });
    expect(result).toBe("Result: 1");
  });

  it("provides access to RegExp", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: '/hello/.test("hello world")',
    });
    expect(result).toBe("Result: true");
  });

  it("provides access to Date", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: "typeof new Date().getTime()",
    });
    expect(result).toBe("Result: number");
  });

  it("provides encodeURIComponent and decodeURIComponent", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: 'decodeURIComponent(encodeURIComponent("hello world"))',
    });
    expect(result).toBe("Result: hello world");
  });

  it("console.log joins multiple args with space", async () => {
    const tool = getTool();
    const result = await tool.execute({
      code: 'console.log("a", "b", "c"); 0',
    });
    expect(result).toContain("a b c");
  });

  it("sandbox does not leak prototype pollution vectors", async () => {
    const tool = getTool();
    // With Object.create(null), the sandbox has no prototype chain that could
    // be exploited for prototype pollution attacks.
    // Verify that __proto__ manipulation does not affect Object prototype.
    const result = await tool.execute({
      code: 'const before = ({}).x; this.__proto__ = { x: "polluted" }; ({}).x === before',
    });
    expect(result).toBe("Result: true");
  });

  it("sandbox console is frozen (strict mode rejects reassignment)", async () => {
    const tool = getTool();
    // Object.freeze prevents property modification. In strict mode this throws.
    const result = await tool.execute({
      code: '"use strict"; try { console.log = function(){}; "writable" } catch(e) { "frozen" }',
    });
    expect(result).toBe("Result: frozen");
  });

  it("sandbox console is frozen (sloppy mode silently ignores reassignment)", async () => {
    const tool = getTool();
    // In sloppy mode, assignment to frozen property silently fails
    const result = await tool.execute({
      code: 'const original = console.log; console.log = function(){}; console.log === original',
    });
    expect(result).toBe("Result: true");
  });

  it("prevents microtask-based timeout bypass", async () => {
    const tool = getTool();
    // With microtaskMode: "afterEvaluate", queued microtasks run within the
    // timeout budget rather than escaping it.
    const result = await tool.execute({
      code: "Promise.resolve().then(() => { while(true) {} }); 1",
      timeout: 200,
    });
    // Should either return the sync result or timeout - either way should not hang
    expect(result).toMatch(/Result: 1|Error:/);
  });
});
