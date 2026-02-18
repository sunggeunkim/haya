import type { AgentTool, ToolCall, ToolResult } from "./types.js";

/**
 * Tool execution framework.
 * Tools are registered by plugins and invoked by the agent runtime
 * when the AI model requests tool calls.
 */

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  size(): number {
    return this.tools.size;
  }

  /**
   * Execute a single tool call. Catches errors and returns them as
   * error results rather than throwing.
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        content: `Tool not found: ${toolCall.name}`,
        isError: true,
      };
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    } catch {
      return {
        toolCallId: toolCall.id,
        content: `Invalid tool arguments: ${toolCall.arguments}`,
        isError: true,
      };
    }

    try {
      const result = await tool.execute(args);
      return { toolCallId: toolCall.id, content: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: toolCall.id,
        content: `Tool execution error: ${message}`,
        isError: true,
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel.
   */
  async executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((tc) => this.execute(tc)));
  }
}
