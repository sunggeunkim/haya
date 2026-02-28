import type { z } from "zod";
import type { SpecialistSchema } from "../config/schema.js";
import type { AIProvider } from "./providers.js";
import { AgentRuntime } from "./runtime.js";
import { ToolRegistry } from "./tools.js";
import type { AgentTool } from "./types.js";

/**
 * Specialist configuration inferred from the Zod schema.
 */
export type SpecialistConfig = z.infer<typeof SpecialistSchema>;

/**
 * Context needed to create delegation tools.
 */
export interface DelegationContext {
  provider: AIProvider;
  defaultModel: string;
  sourceTools: ToolRegistry;
  specialists: SpecialistConfig[];
}

/** Maximum tool rounds for specialist runtimes to prevent runaway loops. */
const SPECIALIST_MAX_TOOL_ROUNDS = 5;

/**
 * Creates the `delegate_task` tool that lets the main agent delegate
 * subtasks to specialist agents.
 *
 * Each specialist gets its own `AgentRuntime` with a filtered tool set
 * (only tools listed in its config). Specialists do NOT receive the
 * `delegate_task` tool, preventing infinite delegation chains.
 *
 * Specialist runtimes are lazily created and cached for reuse.
 */
export function createDelegationTools(ctx: DelegationContext): AgentTool[] {
  const runtimeCache = new Map<string, AgentRuntime>();

  const specialistDescriptions = ctx.specialists
    .map((s) => `- "${s.name}": ${s.description}`)
    .join("\n");

  return [
    {
      name: "delegate_task",
      description:
        "Delegate a subtask to a specialist agent. Available specialists:\n" +
        specialistDescriptions,
      parameters: {
        type: "object",
        properties: {
          specialist: {
            type: "string",
            description: "Name of the specialist to delegate to",
          },
          task: {
            type: "string",
            description: "The task description / question for the specialist",
          },
        },
        required: ["specialist", "task"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const specialistName = args.specialist as string;
        const task = args.task as string;

        if (!specialistName) return "Error: specialist name is required";
        if (!task) return "Error: task description is required";

        const spec = ctx.specialists.find((s) => s.name === specialistName);
        if (!spec) {
          const available = ctx.specialists.map((s) => s.name).join(", ");
          return `Error: unknown specialist "${specialistName}". Available: ${available}`;
        }

        let runtime = runtimeCache.get(specialistName);
        if (!runtime) {
          runtime = buildSpecialistRuntime(ctx, spec);
          runtimeCache.set(specialistName, runtime);
        }

        const response = await runtime.chat(
          {
            sessionId: `specialist-${specialistName}-${Date.now()}`,
            message: task,
          },
          [], // stateless — no history
        );

        return response.message.content || "(specialist returned no response)";
      },
    },
  ];
}

/**
 * Build an `AgentRuntime` for a specialist, filtered to only its allowed tools.
 */
function buildSpecialistRuntime(
  ctx: DelegationContext,
  spec: SpecialistConfig,
): AgentRuntime {
  const filteredTools = new ToolRegistry();

  if (spec.tools && spec.tools.length > 0) {
    for (const toolName of spec.tools) {
      const tool = ctx.sourceTools.get(toolName);
      if (tool) {
        filteredTools.register(tool);
      }
    }
  }
  // If spec.tools is omitted or empty, the specialist gets no tools.
  // The delegate_task tool is intentionally excluded to prevent chains.

  return new AgentRuntime(
    ctx.provider,
    {
      defaultModel: spec.model ?? ctx.defaultModel,
      systemPrompt: spec.systemPrompt,
      maxToolRounds: SPECIALIST_MAX_TOOL_ROUNDS,
    },
    { tools: filteredTools },
  );
}
