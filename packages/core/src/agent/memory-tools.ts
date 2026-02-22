import type { BuiltinTool } from "./builtin-tools.js";
import type { MemorySearchManager } from "../memory/types.js";

const MAX_RESPONSE_LENGTH = 16_000;

/**
 * Create agent tools for storing, searching, and deleting memories.
 */
export function createMemoryTools(
  memoryManager: MemorySearchManager,
): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------
    // memory_store
    // -----------------------------------------------------------------
    {
      name: "memory_store",
      description:
        "Store a piece of information in long-term memory so it can be recalled later. " +
        "Use this to remember facts, preferences, or anything the user asks you to remember.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The content to store in memory",
          },
          source: {
            type: "string",
            description:
              "Where this information came from (e.g. 'user', 'conversation', 'web')",
          },
          metadata: {
            type: "object",
            description: "Optional metadata tags (e.g. { topic: 'work' })",
          },
        },
        required: ["content", "source"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const content = args.content as string;
        const source = args.source as string;
        if (!content) throw new Error("content is required");
        if (!source) throw new Error("source is required");

        const metadata = (args.metadata as Record<string, unknown>) ?? {};
        const id = await memoryManager.index(content, source, metadata);
        return `Stored memory with ID: ${id}`;
      },
    },

    // -----------------------------------------------------------------
    // memory_search
    // -----------------------------------------------------------------
    {
      name: "memory_search",
      description:
        "Search long-term memory for previously stored information. " +
        "Returns the most relevant results ranked by similarity.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant memories",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default: 5)",
          },
        },
        required: ["query"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const query = args.query as string;
        if (!query) throw new Error("query is required");

        const limit = (args.limit as number) ?? 5;
        const results = await memoryManager.search(query, limit);

        if (results.length === 0) {
          return "No matching memories found.";
        }

        const lines: string[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          lines.push(`[${i + 1}] (id: ${r.id}, score: ${r.score.toFixed(3)})`);
          lines.push(`    ${r.content}`);
          if (r.source) {
            lines.push(`    source: ${r.source}`);
          }
        }

        const output = lines.join("\n");
        if (output.length > MAX_RESPONSE_LENGTH) {
          return `${output.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${output.length} chars total]`;
        }
        return output;
      },
    },

    // -----------------------------------------------------------------
    // memory_delete
    // -----------------------------------------------------------------
    {
      name: "memory_delete",
      description:
        "Delete a specific memory entry by its ID. Use memory_search first to find the ID.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The memory ID to delete",
          },
        },
        required: ["id"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const id = args.id as string;
        if (!id) throw new Error("id is required");

        await memoryManager.delete(id);
        return `Deleted memory ${id}`;
      },
    },
  ];
}
