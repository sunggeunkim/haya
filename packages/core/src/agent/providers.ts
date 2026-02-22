import { resolveSecret } from "../config/secrets.js";
import { createBedrockProvider } from "./bedrock.js";
import { fetchWithRetry } from "./retry.js";
import type { RetryOptions } from "./retry.js";
import { parseSSEStream } from "./stream-parser.js";
import type {
  CompletionRequest,
  CompletionResponse,
  Message,
  ProviderConfig,
  StreamDelta,
  TokenUsage,
} from "./types.js";

/**
 * AI provider abstraction. Supports OpenAI-compatible APIs.
 * Providers are resolved at runtime from config — API keys come from env vars.
 */

export interface AIProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  completeStream?(request: CompletionRequest): AsyncGenerator<StreamDelta, CompletionResponse>;
}

/**
 * Create a provider from config. Currently supports OpenAI-compatible APIs.
 */
export function createProvider(config: ProviderConfig): AIProvider {
  const providerName = config.provider.toLowerCase();

  switch (providerName) {
    case "openai":
      return createOpenAICompatibleProvider(config, "https://api.openai.com/v1");
    case "anthropic":
      return createAnthropicProvider(config);
    case "bedrock":
      return createBedrockProvider(config);
    default:
      if (config.baseUrl) {
        return createOpenAICompatibleProvider(config, config.baseUrl);
      }
      throw new Error(`Unknown provider: ${config.provider}. Provide a baseUrl for custom providers.`);
  }
}

function createOpenAICompatibleProvider(
  config: ProviderConfig,
  baseUrl: string,
): AIProvider {
  const retryOpts: Partial<RetryOptions> | undefined = config.retryOptions;

  return {
    name: config.provider,
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      if (!config.apiKeyEnvVar) {
        throw new Error("apiKeyEnvVar is required for OpenAI-compatible providers");
      }
      const apiKey = resolveSecret(config.apiKeyEnvVar);
      if (!apiKey) {
        throw new Error(
          `API key not found in env var: ${config.apiKeyEnvVar}`,
        );
      }

      const body = {
        model: request.model,
        messages: request.messages.map(formatOpenAIMessage),
        ...(request.maxTokens && { max_tokens: request.maxTokens }),
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        ...(request.tools && request.tools.length > 0 && {
          tools: request.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
        }),
      };

      const response = await fetchWithRetry(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        retryOpts,
      );

      const data = (await response.json()) as OpenAIResponse;
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error("No completion choice returned from provider");
      }

      const message: Message = {
        role: "assistant",
        content: choice.message.content ?? "",
        ...(choice.message.tool_calls && {
          toolCalls: choice.message.tool_calls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })),
        }),
      };

      const usage: TokenUsage | undefined = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined;

      const finishReason =
        choice.finish_reason === "tool_calls" ? "tool_calls"
        : choice.finish_reason === "length" ? "length"
        : "stop";

      return { message, usage, finishReason };
    },

    async *completeStream(request: CompletionRequest): AsyncGenerator<StreamDelta, CompletionResponse> {
      if (!config.apiKeyEnvVar) {
        throw new Error("apiKeyEnvVar is required for OpenAI-compatible providers");
      }
      const apiKey = resolveSecret(config.apiKeyEnvVar);
      if (!apiKey) {
        throw new Error(`API key not found in env var: ${config.apiKeyEnvVar}`);
      }

      const body = {
        model: request.model,
        messages: request.messages.map(formatOpenAIMessage),
        stream: true,
        ...(request.maxTokens && { max_tokens: request.maxTokens }),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.tools && request.tools.length > 0 && {
          tools: request.tools.map((t) => ({
            type: "function" as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }),
      };

      const response = await fetchWithRetry(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        retryOpts,
      );

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      let content = "";
      const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>();
      let finishReason: CompletionResponse["finishReason"] = "stop";
      let usage: TokenUsage | undefined;

      for await (const chunk of parseSSEStream(response.body)) {
        const choices = chunk.choices as Array<{
          delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
          finish_reason?: string;
        }> | undefined;

        const choice = choices?.[0];
        if (!choice) continue;

        if (choice.delta?.content) {
          content += choice.delta.content;
          yield { content: choice.delta.content };
        }

        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const existing = toolCallAccum.get(tc.index) ?? { id: "", name: "", arguments: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            toolCallAccum.set(tc.index, existing);
          }
        }

        if (choice.finish_reason) {
          finishReason =
            choice.finish_reason === "tool_calls" ? "tool_calls"
            : choice.finish_reason === "length" ? "length"
            : "stop";
        }

        // Capture usage from the final chunk (OpenAI includes it when stream_options is set)
        if (chunk.usage) {
          const u = chunk.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          usage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: u.total_tokens };
        }
      }

      const toolCalls = toolCallAccum.size > 0
        ? [...toolCallAccum.values()].map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }))
        : undefined;

      if (toolCalls && toolCalls.length > 0) {
        finishReason = "tool_calls";
      }

      const message: Message = {
        role: "assistant",
        content,
        ...(toolCalls && { toolCalls }),
      };

      return { message, usage, finishReason };
    },
  };
}

function createAnthropicProvider(config: ProviderConfig): AIProvider {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
  const retryOpts: Partial<RetryOptions> | undefined = config.retryOptions;

  return {
    name: "anthropic",
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      if (!config.apiKeyEnvVar) {
        throw new Error("apiKeyEnvVar is required for the Anthropic provider");
      }
      const apiKey = resolveSecret(config.apiKeyEnvVar);
      if (!apiKey) {
        throw new Error(
          `API key not found in env var: ${config.apiKeyEnvVar}`,
        );
      }

      const systemMessages = request.messages.filter((m) => m.role === "system");
      const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

      const body = {
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        ...(systemMessages.length > 0 && {
          system: systemMessages.map((m) => m.content).join("\n\n"),
        }),
        messages: nonSystemMessages.map((m) => {
          if (m.role === "tool") {
            return {
              role: "user" as const,
              content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
            };
          }
          return { role: m.role, content: m.content };
        }),
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        ...(request.tools && request.tools.length > 0 && {
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }),
      };

      const response = await fetchWithRetry(
        `${baseUrl}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        },
        retryOpts,
      );

      const data = (await response.json()) as AnthropicResponse;

      const textContent = data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("") ?? "";

      const toolUseBlocks = data.content?.filter((c) => c.type === "tool_use") ?? [];

      const message: Message = {
        role: "assistant",
        content: textContent,
        ...(toolUseBlocks.length > 0 && {
          toolCalls: toolUseBlocks.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          })),
        }),
      };

      const usage: TokenUsage | undefined = data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined;

      const finishReason =
        data.stop_reason === "tool_use" ? "tool_calls"
        : data.stop_reason === "max_tokens" ? "length"
        : "stop";

      return { message, usage, finishReason };
    },

    async *completeStream(request: CompletionRequest): AsyncGenerator<StreamDelta, CompletionResponse> {
      if (!config.apiKeyEnvVar) {
        throw new Error("apiKeyEnvVar is required for the Anthropic provider");
      }
      const apiKey = resolveSecret(config.apiKeyEnvVar);
      if (!apiKey) {
        throw new Error(`API key not found in env var: ${config.apiKeyEnvVar}`);
      }

      const systemMessages = request.messages.filter((m) => m.role === "system");
      const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

      const body = {
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
        ...(systemMessages.length > 0 && {
          system: systemMessages.map((m) => m.content).join("\n\n"),
        }),
        messages: nonSystemMessages.map((m) => {
          if (m.role === "tool") {
            return {
              role: "user" as const,
              content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
            };
          }
          return { role: m.role, content: m.content };
        }),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.tools && request.tools.length > 0 && {
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }),
      };

      const response = await fetchWithRetry(
        `${baseUrl}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        },
        retryOpts,
      );

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      let content = "";
      const toolUseBlocks: Array<{ id: string; name: string; input: string }> = [];
      let currentToolIndex = -1;
      let finishReason: CompletionResponse["finishReason"] = "stop";
      let usage: TokenUsage | undefined;

      for await (const event of parseSSEStream(response.body)) {
        const type = event.type as string;

        if (type === "content_block_delta") {
          const delta = event.delta as { type: string; text?: string; partial_json?: string };
          if (delta.type === "text_delta" && delta.text) {
            content += delta.text;
            yield { content: delta.text };
          }
          if (delta.type === "input_json_delta" && delta.partial_json && currentToolIndex >= 0) {
            toolUseBlocks[currentToolIndex].input += delta.partial_json;
          }
        } else if (type === "content_block_start") {
          const block = event.content_block as { type: string; id?: string; name?: string };
          if (block.type === "tool_use") {
            currentToolIndex = toolUseBlocks.length;
            toolUseBlocks.push({ id: block.id ?? "", name: block.name ?? "", input: "" });
          }
        } else if (type === "message_delta") {
          const delta = event.delta as { stop_reason?: string };
          if (delta.stop_reason) {
            finishReason =
              delta.stop_reason === "tool_use" ? "tool_calls"
              : delta.stop_reason === "max_tokens" ? "length"
              : "stop";
          }
          const u = event.usage as { output_tokens?: number } | undefined;
          if (u?.output_tokens !== undefined && usage) {
            usage.completionTokens = u.output_tokens;
            usage.totalTokens = usage.promptTokens + u.output_tokens;
          }
        } else if (type === "message_start") {
          const msg = event.message as { usage?: { input_tokens: number; output_tokens: number } };
          if (msg?.usage) {
            usage = {
              promptTokens: msg.usage.input_tokens,
              completionTokens: msg.usage.output_tokens,
              totalTokens: msg.usage.input_tokens + msg.usage.output_tokens,
            };
          }
        }
      }

      const toolCalls = toolUseBlocks.length > 0
        ? toolUseBlocks.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.input }))
        : undefined;

      const message: Message = {
        role: "assistant",
        content,
        ...(toolCalls && { toolCalls }),
      };

      return { message, usage, finishReason };
    },
  };
}

function formatOpenAIMessage(
  msg: Message,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };
  if (msg.name) base.name = msg.name;
  if (msg.toolCallId) base.tool_call_id = msg.toolCallId;
  if (msg.toolCalls) {
    base.tool_calls = msg.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  return base;
}

// OpenAI response types (minimal)
interface OpenAIResponse {
  choices?: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Anthropic response types (minimal)
interface AnthropicResponse {
  content?: Array<{
    type: string;
    text: string;
    id: string;
    name: string;
    input: unknown;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason?: string;
}
