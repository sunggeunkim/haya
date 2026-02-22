/**
 * Retry utility with exponential backoff for transient provider errors.
 */

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: Set<number>;
  retryableErrorCodes: Set<string>;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 8000,
  backoffMultiplier: 2,
  retryableStatusCodes: new Set([429, 503]),
  retryableErrorCodes: new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
  ]),
};

export class RetryableProviderError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`Provider returned ${statusCode}: ${responseBody}`);
    this.name = "RetryableProviderError";
  }
}

export class ProviderHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
  ) {
    super(`Provider returned ${statusCode}: ${responseBody}`);
    this.name = "ProviderHttpError";
  }
}

function isRetryableError(err: unknown, options: RetryOptions): boolean {
  if (err instanceof RetryableProviderError) return true;

  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && options.retryableErrorCodes.has(code)) return true;
    if (err.cause && typeof err.cause === "object" && "code" in err.cause) {
      const causeCode = (err.cause as { code?: string }).code;
      if (causeCode && options.retryableErrorCodes.has(causeCode)) return true;
    }
  }

  return false;
}

function getRetryDelay(
  err: unknown,
  attempt: number,
  options: RetryOptions,
): number {
  // Respect Retry-After header if available
  if (err instanceof RetryableProviderError && err.retryAfterMs) {
    return Math.min(err.retryAfterMs, options.maxDelayMs);
  }

  const delay = options.initialDelayMs * options.backoffMultiplier ** attempt;
  return Math.min(delay, options.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry and exponential backoff.
 * Only retries on transient errors (429, 503, network errors).
 * Non-retryable errors propagate immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (!isRetryableError(err, opts) || attempt === opts.maxRetries) {
        throw error;
      }

      lastError = error;
      const delay = getRetryDelay(err, attempt, opts);
      await sleep(delay);
    }
  }

  throw lastError ?? new Error("Retry exhausted with no error");
}

/**
 * Perform a fetch with automatic retry on transient errors.
 * Checks response status and throws RetryableProviderError for retryable codes.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: Partial<RetryOptions>,
): Promise<Response> {
  return withRetry(async () => {
    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text();
      const retryableStatusCodes =
        options?.retryableStatusCodes ?? DEFAULT_OPTIONS.retryableStatusCodes;

      if (retryableStatusCodes.has(response.status)) {
        const retryAfter = response.headers.get("retry-after");
        const retryAfterMs = retryAfter
          ? parseRetryAfter(retryAfter)
          : undefined;
        throw new RetryableProviderError(
          response.status,
          text,
          retryAfterMs,
        );
      }

      throw new ProviderHttpError(response.status, text);
    }

    return response;
  }, options);
}

function parseRetryAfter(value: string): number | undefined {
  const seconds = Number.parseInt(value, 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : undefined;
  }

  return undefined;
}
