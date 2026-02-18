import type { EmbeddingProvider } from "./types.js";
import { normalizeEmbedding } from "./sqlite-vec.js";

export interface EmbeddingProviderConfig {
  provider: "openai";
  model?: string;
  apiKeyEnvVar: string;
  baseUrl?: string;
  dimensions?: number;
}

const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_DIMENSIONS = 1536;

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  if (config.provider === "openai") {
    return createOpenAiEmbeddingProvider(config);
  }
  throw new Error(`Unsupported embedding provider: ${config.provider}`);
}

function createOpenAiEmbeddingProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  const model = config.model ?? DEFAULT_OPENAI_MODEL;
  const dimensions = config.dimensions ?? DEFAULT_OPENAI_DIMENSIONS;
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";

  function resolveApiKey(): string {
    const envVar = config.apiKeyEnvVar;
    const key = process.env[envVar];
    if (!key) {
      throw new Error(
        `Embedding API key not found in environment variable: ${envVar}`,
      );
    }
    return key;
  }

  async function embed(text: string): Promise<number[]> {
    const apiKey = resolveApiKey();
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model,
        dimensions,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Embedding API error (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return normalizeEmbedding(data.data[0].embedding);
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const apiKey = resolveApiKey();
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model,
        dimensions,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Embedding API error (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to ensure correct order
    const sorted = data.data.toSorted((a, b) => a.index - b.index);
    return sorted.map((d) => normalizeEmbedding(d.embedding));
  }

  return {
    id: "openai",
    model,
    dimensions,
    embed,
    embedBatch,
  };
}
