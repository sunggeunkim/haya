import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TokenUsage } from "../agent/types.js";

export interface UsageRecord {
  sessionId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
}

export class UsageTracker {
  private readonly filePath: string;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }
    this.filePath = join(dataDir, "usage.jsonl");
    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, "", { mode: 0o600 });
    }
  }

  /**
   * Record token usage from a chat response.
   */
  record(sessionId: string, model: string, usage: TokenUsage): void {
    const record: UsageRecord = {
      sessionId,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      timestamp: Date.now(),
    };
    appendFileSync(this.filePath, JSON.stringify(record) + "\n");
  }

  /**
   * Get all usage records.
   */
  private readAll(): UsageRecord[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line) as UsageRecord;
      } catch {
        return null;
      }
    }).filter((r): r is UsageRecord => r !== null);
  }

  /**
   * Get usage for a specific session.
   */
  getSessionUsage(sessionId: string): { totalTokens: number; records: UsageRecord[] } {
    const records = this.readAll().filter((r) => r.sessionId === sessionId);
    const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0);
    return { totalTokens, records };
  }

  /**
   * Get total usage since a given timestamp.
   */
  getTotalUsage(since?: number): { totalTokens: number; promptTokens: number; completionTokens: number; requestCount: number } {
    const records = since
      ? this.readAll().filter((r) => r.timestamp >= since)
      : this.readAll();

    return {
      totalTokens: records.reduce((sum, r) => sum + r.totalTokens, 0),
      promptTokens: records.reduce((sum, r) => sum + r.promptTokens, 0),
      completionTokens: records.reduce((sum, r) => sum + r.completionTokens, 0),
      requestCount: records.length,
    };
  }

  /**
   * Get usage grouped by model.
   */
  getUsageByModel(since?: number): Map<string, { totalTokens: number; requestCount: number }> {
    const records = since
      ? this.readAll().filter((r) => r.timestamp >= since)
      : this.readAll();

    const byModel = new Map<string, { totalTokens: number; requestCount: number }>();
    for (const record of records) {
      const existing = byModel.get(record.model) ?? { totalTokens: 0, requestCount: 0 };
      existing.totalTokens += record.totalTokens;
      existing.requestCount++;
      byModel.set(record.model, existing);
    }
    return byModel;
  }
}
