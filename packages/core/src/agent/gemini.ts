/**
 * Google Gemini provider using the native REST API (no SDK dependency).
 * Uses the v1beta generateContent and streamGenerateContent endpoints.
 */

import { resolveSecret } from "../config/secrets.js";
import { fetchWithRetry } from "./retry.js";
import { parseSSEStream } from "./stream-parser.js";
import type { RetryOptions } from "./retry.js";
import type {
  AgentTool,
  CompletionRequest,
  CompletionResponse,
  Message,
  ProviderConfig,
  StreamDelta,
  TokenUsage,
} from "./types.js";
import type { AIProvider } from "./providers.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ---------------------------------------------------------------------------
// Gemini API types
// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { content: string } };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiResponse {
  candidates?: Array<{
    content: { parts: GeminiPart[]; role: string };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/**
 * Convert internal messages to Gemini format.
 * System messages are extracted into systemInstruction.
 * Consecutive tool results are merged into a single user message.
 */
export function formatGeminiMessages(messages: Message[]): {
  systemInstruction: { parts: Array<{ text: string }> } | undefined;
  contents: GeminiContent[];
} {
  const systemParts: Array<{ text: string }> = [];
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push({ text: msg.content });
      continue;
    }

    if (msg.role === "tool") {
      const responsePart: GeminiPart = {
        functionResponse: {
          name: msg.name ?? msg.toolCallId ?? "unknown",
          response: { content: msg.content },
        },
      };

      // Merge consecutive tool results into a single user message
      const last = contents[contents.length - 1];
      if (last && last.role === "user") {
        last.parts.push(responsePart);
      } else {
        contents.push({ role: "user", parts: [responsePart] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: JSON.parse(tc.arguments),
            },
          });
        }
      }
      contents.push({ role: "model", parts });
      continue;
    }

    // user messages
    const parts: GeminiPart[] = [];
    if (msg.contentParts && msg.contentParts.length > 0) {
      for (const part of msg.contentParts) {
        if (part.type === "text") {
          parts.push({ text: part.text });
        } else {
          // Gemini URL image support is limited; include as text reference
          parts.push({ text: `[Image: ${part.image_url.url}]` });
        }
      }
    } else {
      parts.push({ text: msg.content });
    }
    contents.push({ role: "user", parts });
  }

  return {
    systemInstruction: systemParts.length > 0 ? { parts: systemParts } : undefined,
    contents,
  };
}

/**
 * Convert internal AgentTool[] to Gemini function declarations.
 */
function formatGeminiTools(
  tools: AgentTool[],
): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Create a Google Gemini AI provider.
 */
export function createGeminiProvider(config: ProviderConfig): AIProvider {
  const retryOpts: Partial<RetryOptions> | undefined = config.retryOptions;

  return {
    name: "gemini",

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      if (!config.apiKeyEnvVar) {
        throw new Error("apiKeyEnvVar is required for the Gemini provider");
      }
      const apiKey = resolveSecret(config.apiKeyEnvVar);
      if (!apiKey) {
        throw new Error(`API key not found in env var: ${config.apiKeyEnvVar}`);
      }

      const { systemInstruction, contents } = formatGeminiMessages(request.messages);

      const body: Record<string, unknown> = {
        contents,
        ...(systemInstruction && { systemInstruction }),
        ...(request.tools && request.tools.length > 0 && {
          tools: formatGeminiTools(request.tools),
        }),
        generationConfig: {
          ...(request.maxTokens && { maxOutputTokens: request.maxTokens }),
          ...(request.temperature !== undefined && { temperature: request.temperature }),
        },
      };

      const url = `${GEMINI_API_BASE}/models/${request.model}:generateContent?key=${apiKey}`;
      const response = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        retryOpts,
      );

      const data = (await response.json()) as GeminiResponse;
      return parseGeminiResponse(data);
    },

    async *completeStream(
      request: CompletionRequest,
    ): AsyncGenerator<StreamDelta, CompletionResponse> {
      if (!config.apiKeyEnvVar) {
        throw new Error("apiKeyEnvVar is required for the Gemini provider");
      }
      const apiKey = resolveSecret(config.apiKeyEnvVar);
      if (!apiKey) {
        throw new Error(`API key not found in env var: ${config.apiKeyEnvVar}`);
      }

      const { systemInstruction, contents } = formatGeminiMessages(request.messages);

      const body: Record<string, unknown> = {
        contents,
        ...(systemInstruction && { systemInstruction }),
        ...(request.tools && request.tools.length > 0 && {
          tools: formatGeminiTools(request.tools),
        }),
        generationConfig: {
          ...(request.maxTokens && { maxOutputTokens: request.maxTokens }),
          ...(request.temperature !== undefined && { temperature: request.temperature }),
        },
      };

      const url = `${GEMINI_API_BASE}/models/${request.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
      const response = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        retryOpts,
      );

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      let content = "";
      const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      let finishReason: CompletionResponse["finishReason"] = "stop";
      let usage: TokenUsage | undefined;

      for await (const chunk of parseSSEStream(response.body)) {
        const candidates = (chunk as GeminiResponse).candidates;
        if (!candidates || candidates.length === 0) {
          // Check for usage in non-candidate chunks
          const meta = (chunk as GeminiResponse).usageMetadata;
          if (meta) {
            usage = {
              promptTokens: meta.promptTokenCount ?? 0,
              completionTokens: meta.candidatesTokenCount ?? 0,
              totalTokens: meta.totalTokenCount ?? 0,
            };
          }
          continue;
        }

        const candidate = candidates[0];
        for (const part of candidate.content?.parts ?? []) {
          if (part.text) {
            content += part.text;
            yield { content: part.text };
          }
          if (part.functionCall) {
            toolCalls.push({
              name: part.functionCall.name,
              args: part.functionCall.args,
            });
          }
        }

        if (candidate.finishReason) {
          finishReason = mapGeminiFinishReason(candidate.finishReason);
        }

        const meta = (chunk as GeminiResponse).usageMetadata;
        if (meta) {
          usage = {
            promptTokens: meta.promptTokenCount ?? 0,
            completionTokens: meta.candidatesTokenCount ?? 0,
            totalTokens: meta.totalTokenCount ?? 0,
          };
        }
      }

      if (toolCalls.length > 0) {
        finishReason = "tool_calls";
      }

      const message: Message = {
        role: "assistant",
        content,
        ...(toolCalls.length > 0 && {
          toolCalls: toolCalls.map((tc, i) => ({
            id: `call_${i}`,
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          })),
        }),
      };

      return { message, usage, finishReason };
    },
  };
}

// ---------------------------------------------------------------------------
// Response parsing helpers
// ---------------------------------------------------------------------------

function mapGeminiFinishReason(
  reason: string,
): CompletionResponse["finishReason"] {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    default:
      return "stop";
  }
}

function parseGeminiResponse(data: GeminiResponse): CompletionResponse {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("No completion candidate returned from Gemini");
  }

  const parts = candidate.content?.parts ?? [];
  const textParts = parts.filter((p) => p.text).map((p) => p.text!);
  const functionCalls = parts.filter((p) => p.functionCall);

  let finishReason = mapGeminiFinishReason(candidate.finishReason);

  if (functionCalls.length > 0) {
    finishReason = "tool_calls";
  }

  const message: Message = {
    role: "assistant",
    content: textParts.join(""),
    ...(functionCalls.length > 0 && {
      toolCalls: functionCalls.map((p, i) => ({
        id: `call_${i}`,
        name: p.functionCall!.name,
        arguments: JSON.stringify(p.functionCall!.args),
      })),
    }),
  };

  const usage: TokenUsage | undefined = data.usageMetadata
    ? {
        promptTokens: data.usageMetadata.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata.totalTokenCount ?? 0,
      }
    : undefined;

  return { message, usage, finishReason };
}
