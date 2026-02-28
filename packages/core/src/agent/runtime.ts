import type { Logger } from "tslog";
import type { IActivityLogger } from "../infra/activity-logger.js";
import { noopActivityLogger } from "../infra/activity-logger.js";
import { createLogger } from "../infra/logger.js";
import type { BudgetEnforcer } from "../sessions/budget.js";
import type { AIProvider } from "./providers.js";
import { ToolRegistry } from "./tools.js";
import type {
  ChatChunkEvent,
  ChatRequest,
  ChatResponse,
  CompletionRequest,
  CompletionResponse,
  Message,
  StreamCallback,
  StreamDelta,
} from "./types.js";

/**
 * Agent runtime — the message -> AI -> response pipeline.
 * Handles tool call loops: if the AI requests tool calls, executes them
 * and re-sends the conversation with results until the AI produces
 * a final text response.
 */

export interface AgentRuntimeConfig {
  defaultModel: string;
  systemPrompt?: string;
  maxToolRounds?: number;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MAX_TOOL_ROUNDS = 10;

export class AgentRuntime {
  readonly tools: ToolRegistry;
  private readonly provider: AIProvider;
  private readonly config: AgentRuntimeConfig;
  private readonly logger: Logger<unknown>;
  private readonly budgetEnforcer?: BudgetEnforcer;
  private readonly activityLogger: IActivityLogger;

  constructor(
    provider: AIProvider,
    config: AgentRuntimeConfig,
    options?: { tools?: ToolRegistry; logger?: Logger<unknown>; budgetEnforcer?: BudgetEnforcer; activityLogger?: IActivityLogger },
  ) {
    this.provider = provider;
    this.config = config;
    this.tools = options?.tools ?? new ToolRegistry();
    this.logger = options?.logger ?? createLogger("agent-runtime");
    this.budgetEnforcer = options?.budgetEnforcer;
    this.activityLogger = options?.activityLogger ?? noopActivityLogger;
  }

  /**
   * Process a chat request through the AI pipeline.
   * Manages tool call loops automatically.
   */
  async chat(
    request: ChatRequest,
    history: Message[],
    onChunk?: StreamCallback,
  ): Promise<ChatResponse> {
    if (this.budgetEnforcer) {
      this.budgetEnforcer.enforce(request.sessionId);
    }

    const model = request.model ?? this.config.defaultModel;
    const systemPrompt = request.systemPrompt ?? this.config.systemPrompt;
    const maxRounds = this.config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

    // Build message array: system prompt + history + new user message
    const messages: Message[] = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    messages.push(...history);
    messages.push({
      role: "user",
      content: request.message,
      ...(request.contentParts && { contentParts: request.contentParts }),
      timestamp: Date.now(),
    });

    const availableTools = this.tools.list();
    const toolsUsed: string[] = [];

    let round = 0;
    while (round < maxRounds) {
      round++;

      const completionRequest: CompletionRequest = {
        model,
        messages,
        tools: availableTools.length > 0 ? availableTools : undefined,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      };

      this.logger.debug(`Completion round ${round}, model: ${model}`);

      const providerStart = Date.now();
      let response: CompletionResponse;

      // Use streaming when callback is provided and provider supports it
      if (onChunk && this.provider.completeStream) {
        const stream = this.provider.completeStream(completionRequest);
        let streamResult: IteratorResult<StreamDelta, CompletionResponse>;
        do {
          streamResult = await stream.next();
          if (!streamResult.done && streamResult.value.content) {
            onChunk({
              sessionId: request.sessionId,
              delta: streamResult.value.content,
              done: false,
            });
          }
        } while (!streamResult.done);
        response = streamResult.value;
      } else {
        response = await this.provider.complete(completionRequest);
      }

      const providerDurationMs = Date.now() - providerStart;
      const toolCallCount = response.message.toolCalls?.length ?? 0;

      this.activityLogger.logProvider({
        sessionId: request.sessionId,
        model,
        round,
        promptTokens: response.usage?.promptTokens,
        completionTokens: response.usage?.completionTokens,
        totalTokens: response.usage?.totalTokens,
        finishReason: response.finishReason,
        durationMs: providerDurationMs,
        toolCallCount,
      });

      messages.push(response.message);

      // If the AI wants to call tools, execute them and loop
      if (
        response.finishReason === "tool_calls" &&
        response.message.toolCalls &&
        response.message.toolCalls.length > 0
      ) {
        this.logger.debug(
          `Tool calls requested: ${response.message.toolCalls.map((tc) => tc.name).join(", ")}`,
        );

        // Collect unique tool names
        for (const tc of response.message.toolCalls) {
          if (!toolsUsed.includes(tc.name)) {
            toolsUsed.push(tc.name);
          }
        }

        const results = await this.tools.executeAll(
          response.message.toolCalls,
          request.sessionId,
        );

        // Add tool results to the conversation
        for (const result of results) {
          messages.push({
            role: "tool",
            content: result.content,
            toolCallId: result.toolCallId,
          });
        }

        continue;
      }

      // Final response — emit chunk if streaming
      if (onChunk) {
        onChunk({
          sessionId: request.sessionId,
          delta: response.message.content,
          done: true,
        });
      }

      return {
        sessionId: request.sessionId,
        message: {
          ...response.message,
          timestamp: Date.now(),
        },
        usage: response.usage,
        toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
      };
    }

    // Max tool rounds exceeded
    this.logger.warn(
      `Max tool rounds (${maxRounds}) exceeded for session ${request.sessionId}`,
    );

    const fallbackMessage: Message = {
      role: "assistant",
      content:
        "I was unable to complete the task within the allowed number of tool execution rounds.",
      timestamp: Date.now(),
    };

    return {
      sessionId: request.sessionId,
      message: fallbackMessage,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    };
  }

  /**
   * Hot-reload: update the system prompt at runtime.
   */
  updateSystemPrompt(prompt: string): void {
    (this.config as { systemPrompt?: string }).systemPrompt = prompt;
  }
}
