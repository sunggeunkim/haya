import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  withRetry,
  fetchWithRetry,
  RetryableProviderError,
  ProviderHttpError,
} from "./retry.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on RetryableProviderError and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableProviderError(429, "rate limited"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { initialDelayMs: 100, maxRetries: 3 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on network errors", async () => {
    const networkError = new Error("Connection reset");
    (networkError as NodeJS.ErrnoException).code = "ECONNRESET";

    const fn = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce("recovered");

    const promise = withRetry(fn, { initialDelayMs: 100, maxRetries: 3 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new ProviderHttpError(401, "unauthorized"));

    await expect(withRetry(fn)).rejects.toThrow("Provider returned 401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries exhausted", async () => {
    vi.useRealTimers();

    const fn = vi
      .fn()
      .mockRejectedValue(new RetryableProviderError(503, "unavailable"));

    await expect(
      withRetry(fn, { maxRetries: 2, initialDelayMs: 10, maxDelayMs: 50 }),
    ).rejects.toThrow("Provider returned 503");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("uses exponential backoff delays", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableProviderError(429, "rate limited"))
      .mockRejectedValueOnce(new RetryableProviderError(429, "rate limited"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, {
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      maxRetries: 3,
    });

    // First retry: 1000ms * 2^0 = 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second retry: 1000ms * 2^1 = 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects Retry-After from RetryableProviderError", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableProviderError(429, "rate limited", 5000))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { initialDelayMs: 100, maxRetries: 3 });

    // Should wait 5000ms (Retry-After) instead of 100ms (initial delay)
    await vi.advanceTimersByTimeAsync(4999);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("caps delay at maxDelayMs", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableProviderError(429, "rate limited", 60000))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, {
      initialDelayMs: 100,
      maxDelayMs: 8000,
      maxRetries: 3,
    });

    // Should cap at 8000ms, not 60000ms
    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;
    expect(result).toBe("ok");
  });

  it("retries on errors with retryable cause code", async () => {
    const innerError = new Error("timeout");
    (innerError as NodeJS.ErrnoException).code = "ETIMEDOUT";
    const wrappedError = new Error("Fetch failed", { cause: innerError });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(wrappedError)
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { initialDelayMs: 50, maxRetries: 3 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns response on success", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const response = await fetchWithRetry("https://api.example.com", {
      method: "POST",
    });

    expect(response.status).toBe(200);
  });

  it("retries on 429 and succeeds", async () => {
    const failResponse = new Response("rate limited", { status: 429 });
    const okResponse = new Response("ok", { status: 200 });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry(
      "https://api.example.com",
      { method: "POST" },
      { initialDelayMs: 100, maxRetries: 3 },
    );

    await vi.advanceTimersByTimeAsync(100);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws ProviderHttpError on non-retryable status", async () => {
    const failResponse = new Response("bad request", { status: 400 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(failResponse);

    await expect(
      fetchWithRetry("https://api.example.com", { method: "POST" }),
    ).rejects.toThrow(ProviderHttpError);
  });

  it("retries on 503 and respects Retry-After header", async () => {
    const headers = new Headers({ "Retry-After": "3" });
    const failResponse = new Response("unavailable", {
      status: 503,
      headers,
    });
    const okResponse = new Response("ok", { status: 200 });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry(
      "https://api.example.com",
      { method: "POST" },
      { initialDelayMs: 100, maxRetries: 3 },
    );

    // Retry-After: 3 → 3000ms
    await vi.advanceTimersByTimeAsync(3000);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
