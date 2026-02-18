import { resolveSecret } from "../config/secrets.js";
import type {
  CompletionRequest,
  CompletionResponse,
  Message,
  ProviderConfig,
  TokenUsage,
} from "./types.js";

/**
 * AI provider abstraction. Supports OpenAI-compatible APIs.
 * Providers are resolved at runtime from config — API keys come from env vars.
 */

export interface AIProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
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
  return {
    name: config.provider,
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
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

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Provider ${config.provider} returned ${response.status}: ${text}`,
        );
      }

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
  };
}

function createAnthropicProvider(config: ProviderConfig): AIProvider {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";

  return {
    name: "anthropic",
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
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
        messages: nonSystemMessages.map((m) => ({
          role: m.role === "tool" ? "user" : m.role,
          content: m.content,
        })),
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

      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Anthropic returned ${response.status}: ${text}`,
        );
      }

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
