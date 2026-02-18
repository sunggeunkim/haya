export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  source: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface MemorySearchManager {
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
  index(
    content: string,
    source: string,
    metadata?: Record<string, unknown>,
  ): Promise<string>;
  delete(id: string): Promise<void>;
  close(): void;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface HybridSearchOptions {
  vectorWeight: number;
  textWeight: number;
  limit: number;
  minScore: number;
}

export const DEFAULT_HYBRID_OPTIONS: HybridSearchOptions = {
  vectorWeight: 0.7,
  textWeight: 0.3,
  limit: 10,
  minScore: 0.01,
};
