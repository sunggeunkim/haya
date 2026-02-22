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

  constructor(entries: ProviderEntry[]) {
    if (entries.length === 0) {
      throw new Error("FallbackProvider requires at least one provider entry");
    }
    this.entries = entries;
    this.name = `fallback(${entries.map((e) => e.provider.name).join(",")})`;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const ordered = this.orderProviders(request.model);
    let lastError: unknown;

    for (const entry of ordered) {
      try {
        return await entry.provider.complete(request);
      } catch (err) {
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
          if (response.message.content) {
            yield { content: response.message.content };
          }
          return response;
        } catch (err) {
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
          return result.value;
        }
        // First chunk succeeded — yield it and continue streaming
        yield result.value;

        // Stream the rest
        while (true) {
          result = await stream.next();
          if (result.done) {
            return result.value;
          }
          yield result.value;
        }
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    throw lastError;
  }

  /**
   * Order providers: model-matched first, then the rest in original order.
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

    return [...matched, ...rest];
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
