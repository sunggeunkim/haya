import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { AutoReplyRule } from "./auto-reply.js";

interface AutoReplyStoreFile {
  version: 1;
  rules: AutoReplyRule[];
}

/**
 * Persistent JSON store for auto-reply rules.
 * Follows the same pattern as CronStore.
 */
export class AutoReplyStore {
  private rules = new Map<string, AutoReplyRule>();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Load rules from the store file. Merges with config-defined rules.
   */
  async load(configRules?: AutoReplyRule[]): Promise<void> {
    let storedRules: AutoReplyRule[] = [];
    try {
      const content = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(content) as AutoReplyStoreFile;
      if (data.version === 1 && Array.isArray(data.rules)) {
        storedRules = data.rules;
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
    }

    this.rules.clear();

    // Load stored rules first
    for (const rule of storedRules) {
      this.rules.set(rule.id, rule);
    }

    // Config rules take precedence
    if (configRules) {
      for (const rule of configRules) {
        this.rules.set(rule.id, rule);
      }
    }
  }

  /**
   * Save current state to the store file.
   */
  async save(): Promise<void> {
    const data: AutoReplyStoreFile = {
      version: 1,
      rules: Array.from(this.rules.values()),
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * List all rules.
   */
  list(): AutoReplyRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a rule by ID.
   */
  get(id: string): AutoReplyRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Add a new rule. Returns the created rule.
   */
  add(
    params: Omit<AutoReplyRule, "id"> & { id?: string },
  ): AutoReplyRule {
    const rule: AutoReplyRule = {
      ...params,
      id: params.id ?? randomUUID(),
    };
    this.rules.set(rule.id, rule);
    return rule;
  }

  /**
   * Remove a rule by ID. Returns true if found and removed.
   */
  remove(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * Get the number of rules.
   */
  get size(): number {
    return this.rules.size;
  }
}
