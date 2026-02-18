import { createMemoryDatabase, type MemoryDatabase } from "./sqlite.js";
import {
  loadSqliteVec,
  createVectorIndex,
  type VectorIndex,
} from "./sqlite-vec.js";
import { createEmbeddingProvider, type EmbeddingProviderConfig } from "./embeddings.js";
import { hybridSearch } from "./hybrid.js";
import type {
  MemorySearchManager,
  MemorySearchResult,
  EmbeddingProvider,
  HybridSearchOptions,
} from "./types.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("memory");

export interface MemoryManagerConfig {
  dbPath: string;
  embedding?: EmbeddingProviderConfig;
  hybridOptions?: Partial<HybridSearchOptions>;
}

export async function createMemoryManager(
  config: MemoryManagerConfig,
): Promise<MemorySearchManager> {
  const memoryDb = createMemoryDatabase(config.dbPath);
  let vectorIndex: VectorIndex | null = null;
  let embeddingProvider: EmbeddingProvider | null = null;

  // Try to load sqlite-vec for vector search
  if (config.embedding) {
    const vecResult = await loadSqliteVec(memoryDb.db);
    if (vecResult.ok) {
      embeddingProvider = createEmbeddingProvider(config.embedding);
      vectorIndex = createVectorIndex(
        memoryDb.db,
        embeddingProvider.dimensions,
      );
      log.info(
        `Vector search enabled (provider=${embeddingProvider.id}, model=${embeddingProvider.model}, dims=${embeddingProvider.dimensions})`,
      );
    } else {
      log.warn(
        `sqlite-vec unavailable, falling back to FTS-only: ${vecResult.error}`,
      );
    }
  } else {
    log.info("No embedding provider configured, using FTS-only search");
  }

  if (!memoryDb.ftsAvailable && !vectorIndex) {
    log.warn(
      "Neither FTS5 nor vector search available. Search will return no results.",
    );
  }

  return {
    async search(
      query: string,
      limit?: number,
    ): Promise<MemorySearchResult[]> {
      let queryEmbedding: number[] | null = null;
      if (embeddingProvider && vectorIndex) {
        try {
          queryEmbedding = await embeddingProvider.embed(query);
        } catch (err) {
          log.warn(
            `Failed to generate query embedding, falling back to FTS: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return hybridSearch({
        query,
        queryEmbedding,
        memoryDb,
        vectorIndex,
        options: {
          ...config.hybridOptions,
          ...(limit !== undefined ? { limit } : {}),
        },
      });
    },

    async index(
      content: string,
      source: string,
      metadata?: Record<string, unknown>,
    ): Promise<string> {
      const now = Date.now();
      const id = memoryDb.insert({
        content,
        source,
        metadata: metadata ?? {},
        createdAt: now,
        updatedAt: now,
      });

      // Generate and store embedding if vector search is available
      if (embeddingProvider && vectorIndex) {
        try {
          const embedding = await embeddingProvider.embed(content);
          vectorIndex.insert(id, embedding);
        } catch (err) {
          log.warn(
            `Failed to generate embedding for indexed content: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Entry is still stored in SQLite and searchable via FTS
        }
      }

      return id;
    },

    async delete(id: string): Promise<void> {
      memoryDb.deleteById(id);
      if (vectorIndex) {
        try {
          vectorIndex.delete(id);
        } catch {
          // Vector entry may not exist
        }
      }
    },

    close(): void {
      memoryDb.close();
    },
  };
}
