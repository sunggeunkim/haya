import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthRateLimiter, type AuthRateLimiter } from "./auth-rate-limit.js";

describe("createAuthRateLimiter", () => {
  let limiter: AuthRateLimiter;

  beforeEach(() => {
    limiter = createAuthRateLimiter({
      maxAttempts: 3,
      windowMs: 10_000,
      lockoutMs: 5_000,
    });
  });

  afterEach(() => {
    limiter.dispose();
  });

  it("allows requests with no prior failures", () => {
    const result = limiter.check("1.2.3.4");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it("tracks failures and reduces remaining", () => {
    limiter.recordFailure("1.2.3.4");
    const result = limiter.check("1.2.3.4");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("locks out after max attempts", () => {
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");

    const result = limiter.check("1.2.3.4");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("does not affect other IPs", () => {
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");

    const otherResult = limiter.check("5.6.7.8");
    expect(otherResult.allowed).toBe(true);
    expect(otherResult.remaining).toBe(3);
  });

  it("exempts loopback addresses by default", () => {
    for (let i = 0; i < 20; i++) {
      limiter.recordFailure("127.0.0.1");
    }
    const result = limiter.check("127.0.0.1");
    expect(result.allowed).toBe(true);
  });

  it("exempts ::1 loopback", () => {
    for (let i = 0; i < 20; i++) {
      limiter.recordFailure("::1");
    }
    const result = limiter.check("::1");
    expect(result.allowed).toBe(true);
  });

  it("does not exempt loopback when configured off", () => {
    const strictLimiter = createAuthRateLimiter({
      maxAttempts: 3,
      windowMs: 10_000,
      lockoutMs: 5_000,
      exemptLoopback: false,
    });

    for (let i = 0; i < 3; i++) {
      strictLimiter.recordFailure("127.0.0.1");
    }
    const result = strictLimiter.check("127.0.0.1");
    expect(result.allowed).toBe(false);
    strictLimiter.dispose();
  });

  it("resets state for an IP", () => {
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");

    expect(limiter.check("1.2.3.4").allowed).toBe(false);
    limiter.reset("1.2.3.4");
    expect(limiter.check("1.2.3.4").allowed).toBe(true);
  });

  it("reports size correctly", () => {
    expect(limiter.size()).toBe(0);
    limiter.recordFailure("1.2.3.4");
    expect(limiter.size()).toBe(1);
    limiter.recordFailure("5.6.7.8");
    expect(limiter.size()).toBe(2);
  });

  it("prunes expired entries", () => {
    vi.useFakeTimers();
    const fakeLimiter = createAuthRateLimiter({
      maxAttempts: 3,
      windowMs: 1_000,
      lockoutMs: 1_000,
    });

    fakeLimiter.recordFailure("1.2.3.4");
    expect(fakeLimiter.size()).toBe(1);

    // Advance past window
    vi.advanceTimersByTime(2_000);
    fakeLimiter.prune();
    expect(fakeLimiter.size()).toBe(0);

    fakeLimiter.dispose();
    vi.useRealTimers();
  });

  it("unlocks after lockout period expires", () => {
    vi.useFakeTimers();
    const fakeLimiter = createAuthRateLimiter({
      maxAttempts: 2,
      windowMs: 10_000,
      lockoutMs: 1_000,
    });

    fakeLimiter.recordFailure("1.2.3.4");
    fakeLimiter.recordFailure("1.2.3.4");
    expect(fakeLimiter.check("1.2.3.4").allowed).toBe(false);

    vi.advanceTimersByTime(1_100);
    expect(fakeLimiter.check("1.2.3.4").allowed).toBe(true);

    fakeLimiter.dispose();
    vi.useRealTimers();
  });

  it("handles undefined IP gracefully", () => {
    limiter.recordFailure(undefined);
    // Uses "unknown" as key
    const result = limiter.check(undefined);
    expect(result.remaining).toBe(2);
  });
});
