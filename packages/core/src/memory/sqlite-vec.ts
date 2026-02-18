import type { DatabaseSync } from "node:sqlite";

export interface VectorIndex {
  insert(id: string, embedding: number[]): void;
  search(
    queryEmbedding: number[],
    limit: number,
  ): Array<{ id: string; distance: number }>;
  delete(id: string): void;
  readonly dimensions: number;
  readonly available: boolean;
}

export async function loadSqliteVec(
  db: DatabaseSync,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sqliteVec = await import("sqlite-vec");
    sqliteVec.load(db);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export function createVectorIndex(
  db: DatabaseSync,
  dimensions: number,
): VectorIndex {
  const tableName = "memory_vec";

  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(id TEXT PRIMARY KEY, embedding float[${dimensions}])`,
  );

  const insertStmt = db.prepare(
    `INSERT INTO ${tableName}(id, embedding) VALUES (?, vec_f32(?))`,
  );
  const searchStmt = db.prepare(
    `SELECT id, distance FROM ${tableName} WHERE embedding MATCH vec_f32(?) ORDER BY distance LIMIT ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);

  return {
    dimensions,
    available: true,

    insert(id: string, embedding: number[]): void {
      const buffer = float32ArrayToBuffer(embedding);
      insertStmt.run(id, buffer);
    },

    search(
      queryEmbedding: number[],
      limit: number,
    ): Array<{ id: string; distance: number }> {
      const buffer = float32ArrayToBuffer(queryEmbedding);
      return searchStmt.all(buffer, limit) as Array<{
        id: string;
        distance: number;
      }>;
    },

    delete(id: string): void {
      deleteStmt.run(id);
    },
  };
}

function float32ArrayToBuffer(arr: number[]): Buffer {
  return Buffer.from(new Float32Array(arr).buffer);
}

export function distanceToScore(distance: number): number {
  // sqlite-vec uses L2 distance; convert to 0-1 similarity score
  // Using inverse: score = 1 / (1 + distance)
  return 1 / (1 + Math.max(0, distance));
}

export function normalizeEmbedding(vec: number[]): number[] {
  const sanitized = vec.map((v) => (Number.isFinite(v) ? v : 0));
  const magnitude = Math.sqrt(
    sanitized.reduce((sum, v) => sum + v * v, 0),
  );
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((v) => v / magnitude);
}
