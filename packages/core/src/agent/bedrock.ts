/**
 * AWS Bedrock provider using the Converse API.
 * The SDK is lazy-loaded so users who don't use Bedrock don't need it installed.
 */

import { withRetry } from "./retry.js";
import { RetryableProviderError } from "./retry.js";
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

// Lazy-loaded SDK module cache
let bedrockModule: typeof import("@aws-sdk/client-bedrock-runtime") | null = null;

async function loadBedrockSdk(): Promise<typeof import("@aws-sdk/client-bedrock-runtime")> {
  if (bedrockModule) return bedrockModule;
  try {
    bedrockModule = await import("@aws-sdk/client-bedrock-runtime");
    return bedrockModule;
  } catch {
    throw new Error(
      "AWS Bedrock SDK not installed. Run: pnpm add @aws-sdk/client-bedrock-runtime",
    );
  }
}

// Cached client instance
let cachedClient: InstanceType<typeof import("@aws-sdk/client-bedrock-runtime").BedrockRuntimeClient> | null = null;

async function getClient(region?: string) {
  if (cachedClient) return cachedClient;
  const sdk = await loadBedrockSdk();
  const resolvedRegion = region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  cachedClient = new sdk.BedrockRuntimeClient({
    region: resolvedRegion,
    maxAttempts: 1, // Disable SDK retry; use Haya's withRetry instead
  });
  return cachedClient;
}

/**
 * Format internal messages to Bedrock Converse API format.
 * System messages are extracted separately. Tool results are merged
 * into user messages with toolResult content blocks.
 */
export function formatBedrockMessages(messages: Message[]): {
  system: Array<{ text: string }>;
  messages: Array<{ role: string; content: unknown[] }>;
} {
  const system: Array<{ text: string }> = [];
  const formatted: Array<{ role: string; content: unknown[] }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system.push({ text: msg.content });
      continue;
    }

    if (msg.role === "tool") {
      const toolResultBlock = {
        toolResult: {
          toolUseId: msg.toolCallId,
          content: [{ text: msg.content }],
        },
      };

      // Merge consecutive tool results into a single user message
      const last = formatted[formatted.length - 1];
      if (last && last.role === "user") {
        last.content.push(toolResultBlock);
      } else {
        formatted.push({ role: "user", content: [toolResultBlock] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const content: unknown[] = [];
      if (msg.content) {
        content.push({ text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          content.push({
            toolUse: {
              toolUseId: tc.id,
              name: tc.name,
              input: JSON.parse(tc.arguments),
            },
          });
        }
      }
      formatted.push({ role: "assistant", content });
      continue;
    }

    // user messages
    if (msg.contentParts && msg.contentParts.length > 0) {
      const parts = msg.contentParts.map((part) => {
        if (part.type === "text") return { text: part.text };
        return { text: `[Image: ${part.image_url.url}]` };
      });
      formatted.push({ role: "user", content: parts });
    } else {
      formatted.push({ role: "user", content: [{ text: msg.content }] });
    }
  }

  return { system, messages: formatted };
}

function formatBedrockTools(tools: AgentTool[]): unknown[] {
  return tools.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description,
      inputSchema: { json: t.parameters },
    },
  }));
}

function mapStopReason(stopReason: string | undefined): CompletionResponse["finishReason"] {
  switch (stopReason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "end_turn":
    default:
      return "stop";
  }
}

function isRetryableBedrockError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  return (
    name === "ThrottlingException" ||
    name === "ServiceUnavailableException" ||
    name === "ModelTimeoutException"
  );
}

function wrapBedrockError(err: unknown): never {
  if (isRetryableBedrockError(err)) {
    const error = err as Error & { $metadata?: { httpStatusCode?: number } };
    throw new RetryableProviderError(
      error.$metadata?.httpStatusCode ?? 429,
      error.message,
    );
  }
  throw err;
}

/**
 * Parse the Bedrock Converse response into our internal format.
 */
function parseBedrockResponse(data: {
  output?: { message?: { role?: string; content?: Array<{ text?: string; toolUse?: { toolUseId: string; name: string; input: unknown } }> } };
  usage?: { inputTokens?: number; outputTokens?: number };
  stopReason?: string;
}): CompletionResponse {
  const outputContent = data.output?.message?.content ?? [];

  const textParts = outputContent
    .filter((c): c is { text: string } => typeof c.text === "string")
    .map((c) => c.text);

  const toolUseBlocks = outputContent.filter(
    (c): c is { toolUse: { toolUseId: string; name: string; input: unknown } } =>
      c.toolUse !== undefined,
  );

  const message: Message = {
    role: "assistant",
    content: textParts.join(""),
    ...(toolUseBlocks.length > 0 && {
      toolCalls: toolUseBlocks.map((c) => ({
        id: c.toolUse.toolUseId,
        name: c.toolUse.name,
        arguments: JSON.stringify(c.toolUse.input),
      })),
    }),
  };

  const usage: TokenUsage | undefined = data.usage
    ? {
        promptTokens: data.usage.inputTokens ?? 0,
        completionTokens: data.usage.outputTokens ?? 0,
        totalTokens: (data.usage.inputTokens ?? 0) + (data.usage.outputTokens ?? 0),
      }
    : undefined;

  return {
    message,
    usage,
    finishReason: mapStopReason(data.stopReason),
  };
}

/**
 * Create a Bedrock provider that uses the Converse and ConverseStream APIs.
 */
export function createBedrockProvider(config: ProviderConfig): AIProvider {
  const retryOpts = config.retryOptions;

  return {
    name: "bedrock",

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const sdk = await loadBedrockSdk();
      const client = await getClient(config.awsRegion);
      const { system, messages } = formatBedrockMessages(request.messages);

      const input: Record<string, unknown> = {
        modelId: request.model,
        messages,
        ...(system.length > 0 && { system }),
        ...(request.maxTokens && {
          inferenceConfig: {
            maxTokens: request.maxTokens,
            ...(request.temperature !== undefined && { temperature: request.temperature }),
          },
        }),
        ...(!request.maxTokens && request.temperature !== undefined && {
          inferenceConfig: { temperature: request.temperature },
        }),
        ...(request.tools && request.tools.length > 0 && {
          toolConfig: { tools: formatBedrockTools(request.tools) },
        }),
      };

      const data = await withRetry(async () => {
        try {
          return await client.send(new sdk.ConverseCommand(input as never));
        } catch (err) {
          wrapBedrockError(err);
        }
      }, retryOpts);

      return parseBedrockResponse(data as never);
    },

    async *completeStream(request: CompletionRequest): AsyncGenerator<StreamDelta, CompletionResponse> {
      const sdk = await loadBedrockSdk();
      const client = await getClient(config.awsRegion);
      const { system, messages } = formatBedrockMessages(request.messages);

      const input: Record<string, unknown> = {
        modelId: request.model,
        messages,
        ...(system.length > 0 && { system }),
        ...(request.maxTokens && {
          inferenceConfig: {
            maxTokens: request.maxTokens,
            ...(request.temperature !== undefined && { temperature: request.temperature }),
          },
        }),
        ...(!request.maxTokens && request.temperature !== undefined && {
          inferenceConfig: { temperature: request.temperature },
        }),
        ...(request.tools && request.tools.length > 0 && {
          toolConfig: { tools: formatBedrockTools(request.tools) },
        }),
      };

      const response = await withRetry(async () => {
        try {
          return await client.send(new sdk.ConverseStreamCommand(input as never));
        } catch (err) {
          wrapBedrockError(err);
        }
      }, retryOpts);

      let content = "";
      const toolAccum = new Map<number, { id: string; name: string; input: string }>();
      let currentToolIndex = -1;
      let finishReason: CompletionResponse["finishReason"] = "stop";
      let usage: TokenUsage | undefined;

      const stream = (response as { stream?: AsyncIterable<Record<string, unknown>> }).stream;
      if (!stream) {
        throw new Error("No stream in Bedrock ConverseStream response");
      }

      for await (const event of stream) {
        if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta as {
            delta?: { text?: string; toolUse?: { input?: string } };
          };
          if (delta.delta?.text) {
            content += delta.delta.text;
            yield { content: delta.delta.text };
          }
          if (delta.delta?.toolUse?.input && currentToolIndex >= 0) {
            const acc = toolAccum.get(currentToolIndex);
            if (acc) acc.input += delta.delta.toolUse.input;
          }
        } else if (event.contentBlockStart) {
          const start = event.contentBlockStart as {
            start?: { toolUse?: { toolUseId: string; name: string } };
          };
          if (start.start?.toolUse) {
            currentToolIndex = toolAccum.size;
            toolAccum.set(currentToolIndex, {
              id: start.start.toolUse.toolUseId,
              name: start.start.toolUse.name,
              input: "",
            });
          }
        } else if (event.messageStop) {
          const stop = event.messageStop as { stopReason?: string };
          finishReason = mapStopReason(stop.stopReason);
        } else if (event.metadata) {
          const meta = event.metadata as {
            usage?: { inputTokens?: number; outputTokens?: number };
          };
          if (meta.usage) {
            usage = {
              promptTokens: meta.usage.inputTokens ?? 0,
              completionTokens: meta.usage.outputTokens ?? 0,
              totalTokens: (meta.usage.inputTokens ?? 0) + (meta.usage.outputTokens ?? 0),
            };
          }
        }
      }

      const toolCalls = toolAccum.size > 0
        ? [...toolAccum.values()].map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.input,
          }))
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

/**
 * Reset cached client (used in tests).
 */
export function resetBedrockClient(): void {
  cachedClient = null;
  bedrockModule = null;
}
