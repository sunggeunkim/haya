import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "./providers.js";
import { ToolRegistry } from "./tools.js";
import type { AgentTool, CompletionResponse } from "./types.js";
import { createDelegationTools } from "./delegation.js";
import type { SpecialistConfig } from "./delegation.js";

/** Create a mock AI provider that returns a fixed response. */
function mockProvider(responseText: string): AIProvider {
  return {
    name: "mock",
    async complete(): Promise<CompletionResponse> {
      return {
        message: { role: "assistant", content: responseText },
        finishReason: "stop",
      };
    },
  };
}

/** Create a simple dummy tool for testing. */
function dummyTool(name: string): AgentTool {
  return {
    name,
    description: `Dummy tool: ${name}`,
    parameters: { type: "object", properties: {} },
    async execute(): Promise<string> {
      return `${name} executed`;
    },
  };
}

describe("createDelegationTools", () => {
  const baseSpecialists: SpecialistConfig[] = [
    {
      name: "researcher",
      description: "Web research specialist",
      systemPrompt: "You are a research specialist.",
      tools: ["web_search", "web_fetch"],
    },
    {
      name: "coder",
      description: "Code writing specialist",
      systemPrompt: "You are a coding specialist.",
      model: "gpt-4o-mini",
      tools: ["file_read", "file_write"],
    },
  ];

  function buildSourceTools(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(dummyTool("web_search"));
    registry.register(dummyTool("web_fetch"));
    registry.register(dummyTool("file_read"));
    registry.register(dummyTool("file_write"));
    registry.register(dummyTool("shell_exec"));
    return registry;
  }

  it("returns a single delegate_task tool", () => {
    const tools = createDelegationTools({
      provider: mockProvider("ok"),
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("delegate_task");
    expect(tools[0].description).toContain("researcher");
    expect(tools[0].description).toContain("coder");
  });

  it("delegates to a valid specialist and returns its response", async () => {
    const provider = mockProvider("Here is my research.");
    const tools = createDelegationTools({
      provider,
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    const result = await tools[0].execute({
      specialist: "researcher",
      task: "Find info about TypeScript 6",
    });

    expect(result).toBe("Here is my research.");
  });

  it("returns error message for unknown specialist", async () => {
    const tools = createDelegationTools({
      provider: mockProvider("ok"),
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    const result = await tools[0].execute({
      specialist: "nonexistent",
      task: "do something",
    });

    expect(result).toContain("Error: unknown specialist");
    expect(result).toContain("nonexistent");
    expect(result).toContain("researcher");
    expect(result).toContain("coder");
  });

  it("specialist gets only its whitelisted tools", async () => {
    const completeSpy = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
    });

    const provider: AIProvider = {
      name: "mock",
      complete: completeSpy,
    };

    const tools = createDelegationTools({
      provider,
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    await tools[0].execute({
      specialist: "researcher",
      task: "Search for something",
    });

    // The specialist runtime should only have web_search and web_fetch
    const req = completeSpy.mock.calls[0][0];
    const toolNames = req.tools?.map((t: AgentTool) => t.name) ?? [];
    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("web_fetch");
    expect(toolNames).not.toContain("file_read");
    expect(toolNames).not.toContain("file_write");
    expect(toolNames).not.toContain("shell_exec");
    expect(toolNames).not.toContain("delegate_task");
  });

  it("specialist without tools config gets no tools", async () => {
    const completeSpy = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
    });

    const provider: AIProvider = {
      name: "mock",
      complete: completeSpy,
    };

    const tools = createDelegationTools({
      provider,
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: [
        {
          name: "thinker",
          description: "Pure reasoning, no tools",
          systemPrompt: "Think step by step.",
        },
      ],
    });

    await tools[0].execute({
      specialist: "thinker",
      task: "What is 2+2?",
    });

    const req = completeSpy.mock.calls[0][0];
    expect(req.tools).toBeUndefined();
  });

  it("specialist model override is applied", async () => {
    const completeSpy = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
    });

    const provider: AIProvider = {
      name: "mock",
      complete: completeSpy,
    };

    const tools = createDelegationTools({
      provider,
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    // "coder" specialist has model: "gpt-4o-mini"
    await tools[0].execute({
      specialist: "coder",
      task: "Write a function",
    });

    const req = completeSpy.mock.calls[0][0];
    expect(req.model).toBe("gpt-4o-mini");
  });

  it("specialist without model override uses default model", async () => {
    const completeSpy = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
    });

    const provider: AIProvider = {
      name: "mock",
      complete: completeSpy,
    };

    const tools = createDelegationTools({
      provider,
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    // "researcher" specialist has no model override
    await tools[0].execute({
      specialist: "researcher",
      task: "Research something",
    });

    const req = completeSpy.mock.calls[0][0];
    expect(req.model).toBe("gpt-4o");
  });

  it("parallel delegation executes concurrently", async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;

    const provider: AIProvider = {
      name: "mock",
      async complete(): Promise<CompletionResponse> {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        // Simulate async work
        await new Promise((r) => setTimeout(r, 50));
        concurrentCalls--;
        return {
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        };
      },
    };

    const tools = createDelegationTools({
      provider,
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    const delegateTool = tools[0];

    // Simulate parallel execution as ToolRegistry.executeAll would do
    const results = await Promise.all([
      delegateTool.execute({ specialist: "researcher", task: "task 1" }),
      delegateTool.execute({ specialist: "coder", task: "task 2" }),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toBe("done");
    expect(results[1]).toBe("done");
    expect(maxConcurrent).toBe(2);
  });

  it("caches specialist runtimes across calls", async () => {
    const completeSpy = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
    });

    const provider: AIProvider = {
      name: "mock",
      complete: completeSpy,
    };

    const tools = createDelegationTools({
      provider,
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    await tools[0].execute({ specialist: "researcher", task: "task 1" });
    await tools[0].execute({ specialist: "researcher", task: "task 2" });

    // Both calls should use the same provider instance
    expect(completeSpy).toHaveBeenCalledTimes(2);
    // The system prompt should be the same in both calls (same runtime)
    const req1 = completeSpy.mock.calls[0][0];
    const req2 = completeSpy.mock.calls[1][0];
    expect(req1.messages[0].content).toBe(req2.messages[0].content);
    expect(req1.messages[0].content).toBe("You are a research specialist.");
  });

  it("returns error when specialist name is empty", async () => {
    const tools = createDelegationTools({
      provider: mockProvider("ok"),
      defaultModel: "gpt-4o",
      sourceTools: buildSourceTools(),
      specialists: baseSpecialists,
    });

    const result = await tools[0].execute({
      specialist: "",
      task: "do something",
    });

    expect(result).toContain("Error");
  });
});
