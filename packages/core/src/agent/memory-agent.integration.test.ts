import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../sessions/store.js";
import { HistoryManager } from "../sessions/history.js";
import { AgentRuntime } from "./runtime.js";
import { ToolRegistry } from "./tools.js";
import { createMemoryManager } from "../memory/manager.js";
import type { AIProvider } from "./providers.js";
import type {
  AgentTool,
  CompletionRequest,
  CompletionResponse,
  Message,
} from "./types.js";
import type { MemorySearchManager } from "../memory/types.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `haya-agent-mem-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Capturing sequential provider: records every CompletionRequest.messages[],
 * returns pre-defined CompletionResponse objects in order.
 */
function createCapturingProvider(responses: CompletionResponse[]): {
  provider: AIProvider;
  calls: Message[][];
} {
  const calls: Message[][] = [];
  let callIndex = 0;
  const provider: AIProvider = {
    name: "capturing-mock",
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      calls.push(request.messages.map((m) => ({ ...m })));
      const response = responses[callIndex];
      if (!response) {
        throw new Error(`No more mock responses (call ${callIndex})`);
      }
      callIndex++;
      return response;
    },
  };
  return { provider, calls };
}

/**
 * Creates a memory_search AgentTool wired to a MemorySearchManager.
 */
function createMemorySearchTool(
  memoryManager: MemorySearchManager,
): AgentTool {
  return {
    name: "memory_search",
    description: "Search long-term memory for relevant information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = (args as { query: string }).query;
      const results = await memoryManager.search(query);
      if (results.length === 0) return "No results found.";
      return results.map((r) => r.content).join("\n");
    },
  };
}

describe("Memory Agent Integration (Cross-layer)", () => {
  let tempDir: string;
  let memoryManager: MemorySearchManager;

  beforeEach(async () => {
    tempDir = makeTempDir();
    memoryManager = await createMemoryManager({ dbPath: ":memory:" });
  });

  afterEach(() => {
    memoryManager.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("agent recalls indexed knowledge via tool call", async () => {
    // Pre-index knowledge
    await memoryManager.index(
      "The capital of France is Paris",
      "facts",
    );

    const { provider, calls } = createCapturingProvider([
      // Round 1: AI requests memory_search tool
      {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tc-1",
              name: "memory_search",
              arguments: JSON.stringify({ query: "capital France" }),
            },
          ],
        },
        finishReason: "tool_calls",
      },
      // Round 2: AI uses tool result to answer
      {
        message: {
          role: "assistant",
          content: "The capital of France is Paris.",
        },
        finishReason: "stop",
      },
    ]);

    const tools = new ToolRegistry();
    tools.register(createMemorySearchTool(memoryManager));

    const runtime = new AgentRuntime(
      provider,
      { defaultModel: "test" },
      { tools },
    );

    const response = await runtime.chat(
      { sessionId: "s1", message: "What is the capital of France?" },
      [],
    );

    expect(response.message.content).toBe("The capital of France is Paris.");

    // Verify the second provider call includes the tool result
    expect(calls).toHaveLength(2);
    const round2Messages = calls[1];

    // Should have: user, assistant(tool_call), tool(result)
    expect(round2Messages).toHaveLength(3);
    expect(round2Messages[0].role).toBe("user");
    expect(round2Messages[1].role).toBe("assistant");
    expect(round2Messages[1].toolCalls?.[0].name).toBe("memory_search");
    expect(round2Messages[2].role).toBe("tool");
    expect(round2Messages[2].content).toContain("capital of France is Paris");
  });

  it("full pipeline: session history + memory tool in same turn", async () => {
    // Pre-index knowledge
    await memoryManager.index(
      "The population of Tokyo is approximately 14 million",
      "facts",
    );

    const store = new SessionStore(tempDir);
    const historyManager = new HistoryManager(store);

    const { provider, calls } = createCapturingProvider([
      // Turn 1: simple greeting response
      {
        message: { role: "assistant", content: "Hello! How can I help?" },
        finishReason: "stop",
      },
      // Turn 2, Round 1: AI wants to search memory
      {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tc-2",
              name: "memory_search",
              arguments: JSON.stringify({ query: "population Tokyo" }),
            },
          ],
        },
        finishReason: "tool_calls",
      },
      // Turn 2, Round 2: AI answers with tool result
      {
        message: {
          role: "assistant",
          content: "Tokyo has about 14 million people.",
        },
        finishReason: "stop",
      },
    ]);

    const tools = new ToolRegistry();
    tools.register(createMemorySearchTool(memoryManager));

    const runtime = new AgentRuntime(
      provider,
      { defaultModel: "test" },
      { tools },
    );

    // Turn 1: simple chat (replicating entry.ts flow)
    const history1 = historyManager.getHistory("sess-1");
    const resp1 = await runtime.chat(
      { sessionId: "sess-1", message: "Hi there" },
      history1,
    );
    historyManager.addMessages("sess-1", [
      { role: "user", content: "Hi there", timestamp: Date.now() },
      resp1.message,
    ]);

    // Turn 2: triggers memory search
    const history2 = historyManager.getHistory("sess-1");
    const resp2 = await runtime.chat(
      { sessionId: "sess-1", message: "What is the population of Tokyo?" },
      history2,
    );

    expect(resp2.message.content).toBe("Tokyo has about 14 million people.");

    // Verify turn 2 round 1 received conversation history
    const turn2Round1 = calls[1];
    // Should have: history(user + assistant) + new user = 3 messages
    expect(turn2Round1).toHaveLength(3);
    expect(turn2Round1[0].content).toBe("Hi there");
    expect(turn2Round1[1].content).toBe("Hello! How can I help?");
    expect(turn2Round1[2].content).toBe("What is the population of Tokyo?");

    // Verify turn 2 round 2 received both history AND tool results
    const turn2Round2 = calls[2];
    // Should have: history(2) + new user(1) + assistant(tool_call)(1) + tool(result)(1) = 5
    expect(turn2Round2).toHaveLength(5);
    expect(turn2Round2[0].content).toBe("Hi there");
    expect(turn2Round2[3].role).toBe("assistant");
    expect(turn2Round2[4].role).toBe("tool");
    expect(turn2Round2[4].content).toContain("population of Tokyo");
  });

  it("tool returns empty for no-match query", async () => {
    // Index something unrelated
    await memoryManager.index("Cats are domestic animals", "facts");

    const { provider, calls } = createCapturingProvider([
      // AI requests memory_search
      {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tc-3",
              name: "memory_search",
              arguments: JSON.stringify({
                query: "quantum entanglement physics",
              }),
            },
          ],
        },
        finishReason: "tool_calls",
      },
      // AI handles empty result gracefully
      {
        message: {
          role: "assistant",
          content: "I don't have information about that in my memory.",
        },
        finishReason: "stop",
      },
    ]);

    const tools = new ToolRegistry();
    tools.register(createMemorySearchTool(memoryManager));

    const runtime = new AgentRuntime(
      provider,
      { defaultModel: "test" },
      { tools },
    );

    const response = await runtime.chat(
      { sessionId: "s1", message: "Tell me about quantum entanglement" },
      [],
    );

    expect(response.message.content).toBe(
      "I don't have information about that in my memory.",
    );

    // Verify the tool returned "No results found."
    const round2 = calls[1];
    const toolResult = round2.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toBe("No results found.");
  });
});
