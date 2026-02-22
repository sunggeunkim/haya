import { watch, type FSWatcher } from "node:fs";
import { loadConfig } from "./loader.js";
import type { AssistantConfig } from "./types.js";

// Fields that can be hot-reloaded without restart
const SAFE_FIELDS = new Set([
  "logging",
  "agent.systemPrompt",
  "agent.toolPolicies",
  "agent.maxHistoryMessages",
  "agent.maxContextTokens",
  "cron",
]);

// Fields that require a restart
const RESTART_REQUIRED_FIELDS = new Set([
  "gateway",
  "agent.defaultProviderApiKeyEnvVar",
  "agent.providers",
]);

export interface ConfigWatcherOptions {
  filePath: string;
  debounceMs?: number; // default: 500
  onReload: (newConfig: AssistantConfig, changedFields: string[]) => void;
  onError: (error: Error) => void;
}

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentConfig: AssistantConfig;
  private readonly options: Required<Pick<ConfigWatcherOptions, 'debounceMs'>> & ConfigWatcherOptions;

  constructor(options: ConfigWatcherOptions, currentConfig: AssistantConfig) {
    this.options = { debounceMs: 500, ...options };
    this.currentConfig = currentConfig;
  }

  start(): void {
    this.watcher = watch(this.options.filePath, (eventType) => {
      if (eventType === "change") {
        this.scheduleReload();
      }
    });
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.watcher?.close();
    this.watcher = null;
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.reload(), this.options.debounceMs);
  }

  private async reload(): Promise<void> {
    try {
      const newConfig = await loadConfig(this.options.filePath);
      const changed = diffConfig(this.currentConfig, newConfig);

      if (changed.length === 0) return;

      const unsafeChanges = changed.filter(f => {
        for (const restartField of RESTART_REQUIRED_FIELDS) {
          if (f === restartField || f.startsWith(restartField + ".")) return true;
        }
        return false;
      });

      if (unsafeChanges.length > 0) {
        this.options.onError(new Error(
          `Config changes require restart: ${unsafeChanges.join(", ")}`
        ));
      }

      const safeChanges = changed.filter(f => {
        for (const safeField of SAFE_FIELDS) {
          if (f === safeField || f.startsWith(safeField + ".")) return true;
        }
        return false;
      });

      if (safeChanges.length > 0) {
        this.options.onReload(newConfig, safeChanges);
        this.currentConfig = newConfig;
      }
    } catch (err) {
      this.options.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/**
 * Shallow diff of two config objects, returning top-level changed field paths.
 */
export function diffConfig(a: AssistantConfig, b: AssistantConfig): string[] {
  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of allKeys) {
    const aVal = (a as Record<string, unknown>)[key];
    const bVal = (b as Record<string, unknown>)[key];

    if (JSON.stringify(aVal) !== JSON.stringify(bVal)) {
      changed.push(key);

      // For objects, also report nested changes
      if (typeof aVal === "object" && aVal !== null && typeof bVal === "object" && bVal !== null) {
        const aObj = aVal as Record<string, unknown>;
        const bObj = bVal as Record<string, unknown>;
        const nestedKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
        for (const nk of nestedKeys) {
          if (JSON.stringify(aObj[nk]) !== JSON.stringify(bObj[nk])) {
            changed.push(`${key}.${nk}`);
          }
        }
      }
    }
  }

  return changed;
}
