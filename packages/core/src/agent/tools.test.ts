import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./tools.js";
import type { AgentTool, ToolCall } from "./types.js";

function makeTool(name: string, result: string = "ok"): AgentTool {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: "object", properties: {} },
    execute: async () => result,
  };
}

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("test-tool");
    registry.register(tool);
    expect(registry.get("test-tool")).toBe(tool);
    expect(registry.has("test-tool")).toBe(true);
    expect(registry.size()).toBe(1);
  });

  it("rejects duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("dup"));
    expect(() => registry.register(makeTool("dup"))).toThrow(
      /already registered/,
    );
  });

  it("unregisters a tool", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("removable"));
    expect(registry.unregister("removable")).toBe(true);
    expect(registry.has("removable")).toBe(false);
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("lists all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));
    registry.register(makeTool("c"));
    const tools = registry.list();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns undefined for unknown tools", () => {
    const registry = new ToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });
});

describe("ToolRegistry.execute", () => {
  it("executes a tool and returns result", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("greet", "Hello!"));

    const call: ToolCall = {
      id: "call-1",
      name: "greet",
      arguments: "{}",
    };
    const result = await registry.execute(call);
    expect(result.toolCallId).toBe("call-1");
    expect(result.content).toBe("Hello!");
    expect(result.isError).toBeUndefined();
  });

  it("returns error for unknown tool", async () => {
    const registry = new ToolRegistry();
    const call: ToolCall = {
      id: "call-2",
      name: "missing",
      arguments: "{}",
    };
    const result = await registry.execute(call);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Tool not found");
  });

  it("returns error for invalid JSON arguments", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("parser"));

    const call: ToolCall = {
      id: "call-3",
      name: "parser",
      arguments: "not-json",
    };
    const result = await registry.execute(call);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid tool arguments");
  });

  it("catches tool execution errors", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "failing",
      description: "Always fails",
      parameters: {},
      execute: async () => {
        throw new Error("Boom!");
      },
    });

    const call: ToolCall = {
      id: "call-4",
      name: "failing",
      arguments: "{}",
    };
    const result = await registry.execute(call);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Boom!");
  });
});

describe("ToolRegistry.executeAll", () => {
  it("executes multiple tools in parallel", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("a", "result-a"));
    registry.register(makeTool("b", "result-b"));

    const calls: ToolCall[] = [
      { id: "1", name: "a", arguments: "{}" },
      { id: "2", name: "b", arguments: "{}" },
    ];

    const results = await registry.executeAll(calls);
    expect(results).toHaveLength(2);
    expect(results[0]?.content).toBe("result-a");
    expect(results[1]?.content).toBe("result-b");
  });
});
