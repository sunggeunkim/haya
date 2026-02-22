import type { ProviderHealthSnapshot, ProviderHealthTracker } from "./provider-health.js";
import type { AIProvider } from "./providers.js";
import type {
  CompletionRequest,
  CompletionResponse,
  StreamDelta,
} from "./types.js";

/**
 * Provider entry with optional model-pattern routing.
 * If `models` is set, this provider is preferred when the
 * requested model matches one of the glob-style prefixes.
 */
export interface ProviderEntry {
  provider: AIProvider;
  /** Glob-style model prefixes, e.g. ["gpt-*", "o1-*"] */
  models?: string[];
}

/**
 * FallbackProvider — tries providers in order, falling through on error.
 *
 * Routing logic:
 * 1. If a provider has `models` patterns and the requested model matches,
 *    that provider is tried first.
 * 2. On failure, remaining providers are tried in declaration order.
 * 3. If all providers fail, the last error is thrown.
 */
export class FallbackProvider implements AIProvider {
  readonly name: string;
  private readonly entries: ProviderEntry[];
  private readonly healthTracker?: ProviderHealthTracker;

  constructor(entries: ProviderEntry[], healthTracker?: ProviderHealthTracker) {
    if (entries.length === 0) {
      throw new Error("FallbackProvider requires at least one provider entry");
    }
    this.entries = entries;
    this.healthTracker = healthTracker;
    this.name = `fallback(${entries.map((e) => e.provider.name).join(",")})`;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const ordered = this.orderProviders(request.model);
    let lastError: unknown;

    for (const entry of ordered) {
      try {
        const result = await entry.provider.complete(request);
        this.healthTracker?.recordSuccess(entry.provider.name);
        return result;
      } catch (err) {
        this.healthTracker?.recordFailure(entry.provider.name, err);
        lastError = err;
        // Fall through to next provider
      }
    }

    throw lastError;
  }

  async *completeStream(
    request: CompletionRequest,
  ): AsyncGenerator<StreamDelta, CompletionResponse> {
    const ordered = this.orderProviders(request.model);
    let lastError: unknown;

    for (const entry of ordered) {
      if (!entry.provider.completeStream) {
        // Provider doesn't support streaming — try its complete() as fallback
        try {
          const response = await entry.provider.complete(request);
          this.healthTracker?.recordSuccess(entry.provider.name);
          if (response.message.content) {
            yield { content: response.message.content };
          }
          return response;
        } catch (err) {
          this.healthTracker?.recordFailure(entry.provider.name, err);
          lastError = err;
          continue;
        }
      }

      try {
        const stream = entry.provider.completeStream(request);
        let result: IteratorResult<StreamDelta, CompletionResponse>;
        // We need to try the first next() to see if the provider fails
        result = await stream.next();
        if (result.done) {
          this.healthTracker?.recordSuccess(entry.provider.name);
          return result.value;
        }
        // First chunk succeeded — yield it and continue streaming
        yield result.value;

        // Stream the rest
        while (true) {
          result = await stream.next();
          if (result.done) {
            this.healthTracker?.recordSuccess(entry.provider.name);
            return result.value;
          }
          yield result.value;
        }
      } catch (err) {
        this.healthTracker?.recordFailure(entry.provider.name, err);
        lastError = err;
        continue;
      }
    }

    throw lastError;
  }

  /**
   * Get health snapshots for all tracked providers.
   * Returns undefined if no health tracker is configured.
   */
  getHealth(): ProviderHealthSnapshot[] | undefined {
    return this.healthTracker?.getAll();
  }

  /**
   * Order providers: model-matched first, then the rest in original order.
   * When a health tracker is configured, unavailable providers are filtered
   * out — but at least one provider is always kept so that the caller gets
   * a meaningful error instead of an empty list.
   */
  private orderProviders(model: string): ProviderEntry[] {
    const matched: ProviderEntry[] = [];
    const rest: ProviderEntry[] = [];

    for (const entry of this.entries) {
      if (entry.models && this.matchesModel(entry.models, model)) {
        matched.push(entry);
      } else {
        rest.push(entry);
      }
    }

    const ordered = [...matched, ...rest];

    if (!this.healthTracker) return ordered;

    const available = ordered.filter((e) =>
      this.healthTracker!.isAvailable(e.provider.name),
    );

    // Always keep at least one provider so the caller gets a real error
    return available.length > 0 ? available : [ordered[0]];
  }

  /**
   * Check if a model name matches any of the glob patterns.
   * Supports trailing wildcard only: "gpt-*" matches "gpt-4o".
   */
  private matchesModel(patterns: string[], model: string): boolean {
    for (const pattern of patterns) {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        if (model.startsWith(prefix)) return true;
      } else if (pattern === model) {
        return true;
      }
    }
    return false;
  }
}
