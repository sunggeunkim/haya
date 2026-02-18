import type { MemorySearchResult, HybridSearchOptions } from "./types.js";
import { DEFAULT_HYBRID_OPTIONS } from "./types.js";
import type { MemoryDatabase } from "./sqlite.js";
import type { VectorIndex } from "./sqlite-vec.js";
import { distanceToScore } from "./sqlite-vec.js";

export interface HybridSearchInput {
  query: string;
  queryEmbedding: number[] | null;
  memoryDb: MemoryDatabase;
  vectorIndex: VectorIndex | null;
  options?: Partial<HybridSearchOptions>;
}

interface ScoredCandidate {
  id: string;
  vectorScore: number;
  textScore: number;
  combinedScore: number;
}

export function hybridSearch(input: HybridSearchInput): MemorySearchResult[] {
  const opts: HybridSearchOptions = {
    ...DEFAULT_HYBRID_OPTIONS,
    ...input.options,
  };

  const candidateLimit = opts.limit * 4;
  const byId = new Map<string, ScoredCandidate>();

  // Vector search
  if (input.vectorIndex && input.queryEmbedding) {
    const vectorResults = input.vectorIndex.search(
      input.queryEmbedding,
      candidateLimit,
    );
    for (const r of vectorResults) {
      const vectorScore = distanceToScore(r.distance);
      byId.set(r.id, {
        id: r.id,
        vectorScore,
        textScore: 0,
        combinedScore: 0,
      });
    }
  }

  // BM25/FTS search
  if (input.memoryDb.ftsAvailable) {
    const ftsResults = input.memoryDb.searchFts(input.query, candidateLimit);
    for (const r of ftsResults) {
      const textScore = bm25RankToScore(r.rank);
      const existing = byId.get(r.id);
      if (existing) {
        existing.textScore = textScore;
      } else {
        byId.set(r.id, {
          id: r.id,
          vectorScore: 0,
          textScore,
          combinedScore: 0,
        });
      }
    }
  }

  // Compute combined scores
  const vw = opts.vectorWeight;
  const tw = opts.textWeight;
  const sum = vw + tw;
  const normalizedVw = sum > 0 ? vw / sum : 0.7;
  const normalizedTw = sum > 0 ? tw / sum : 0.3;

  for (const candidate of byId.values()) {
    candidate.combinedScore =
      normalizedVw * candidate.vectorScore +
      normalizedTw * candidate.textScore;
  }

  // Sort by combined score descending
  const sorted = Array.from(byId.values())
    .filter((c) => c.combinedScore >= opts.minScore)
    .toSorted((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, opts.limit);

  // Fetch full entries
  const results: MemorySearchResult[] = [];
  for (const candidate of sorted) {
    const entry = input.memoryDb.getById(candidate.id);
    if (entry) {
      results.push({
        id: entry.id,
        content: entry.content,
        source: entry.source,
        score: candidate.combinedScore,
        metadata: entry.metadata,
      });
    }
  }

  return results;
}

export function bm25RankToScore(rank: number): number {
  // SQLite FTS5 rank is a negative BM25 value (more negative = better match).
  // Following OpenClaw's pattern: any FTS match is treated as a strong text signal.
  // score = 1 / (1 + max(0, rank))
  // For matches: rank < 0, max(0, rank) = 0, score = 1.0
  // For non-matches: rank >= 0, score decreases
  const normalized = Number.isFinite(rank)
    ? Math.max(0, rank)
    : 999;
  return 1 / (1 + normalized);
}
