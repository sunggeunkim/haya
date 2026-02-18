import { isLoopbackAddress } from "./net.js";

/**
 * Proxy-aware, per-client-IP sliding-window rate limiter for auth attempts.
 * Uses resolved client IP (after trusted proxy validation) to prevent
 * proxy-collapsed IPs from sharing limits (fixes MED-6).
 */

export interface RateLimitConfig {
  /** Maximum failed attempts before lockout. @default 10 */
  maxAttempts?: number;
  /** Sliding window duration in ms. @default 60_000 (1 min) */
  windowMs?: number;
  /** Lockout duration in ms after limit exceeded. @default 300_000 (5 min) */
  lockoutMs?: number;
  /** Exempt loopback addresses from rate limiting. @default true */
  exemptLoopback?: boolean;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface AuthRateLimiter {
  check(ip: string | undefined): RateLimitCheckResult;
  recordFailure(ip: string | undefined): void;
  reset(ip: string | undefined): void;
  size(): number;
  prune(): void;
  dispose(): void;
}

interface RateLimitEntry {
  attempts: number[];
  lockedUntil?: number;
}

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LOCKOUT_MS = 300_000;
const PRUNE_INTERVAL_MS = 60_000;

export function createAuthRateLimiter(
  config?: RateLimitConfig,
): AuthRateLimiter {
  const maxAttempts = config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  const lockoutMs = config?.lockoutMs ?? DEFAULT_LOCKOUT_MS;
  const exemptLoopback = config?.exemptLoopback ?? true;

  const entries = new Map<string, RateLimitEntry>();

  const pruneTimer = setInterval(() => prune(), PRUNE_INTERVAL_MS);
  if (pruneTimer.unref) pruneTimer.unref();

  function normalizeKey(ip: string | undefined): string {
    return (ip ?? "").trim() || "unknown";
  }

  function isExempt(ip: string): boolean {
    return exemptLoopback && isLoopbackAddress(ip);
  }

  function slideWindow(entry: RateLimitEntry, now: number): void {
    const cutoff = now - windowMs;
    entry.attempts = entry.attempts.filter((ts) => ts > cutoff);
  }

  function check(rawIp: string | undefined): RateLimitCheckResult {
    const ip = normalizeKey(rawIp);
    if (isExempt(ip)) {
      return { allowed: true, remaining: maxAttempts, retryAfterMs: 0 };
    }

    const now = Date.now();
    const entry = entries.get(ip);

    if (!entry) {
      return { allowed: true, remaining: maxAttempts, retryAfterMs: 0 };
    }

    // Still locked out?
    if (entry.lockedUntil && now < entry.lockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: entry.lockedUntil - now,
      };
    }

    // Lockout expired
    if (entry.lockedUntil && now >= entry.lockedUntil) {
      entry.lockedUntil = undefined;
      entry.attempts = [];
    }

    slideWindow(entry, now);
    const remaining = Math.max(0, maxAttempts - entry.attempts.length);
    return { allowed: remaining > 0, remaining, retryAfterMs: 0 };
  }

  function recordFailure(rawIp: string | undefined): void {
    const ip = normalizeKey(rawIp);
    if (isExempt(ip)) return;

    const now = Date.now();
    let entry = entries.get(ip);

    if (!entry) {
      entry = { attempts: [] };
      entries.set(ip, entry);
    }

    if (entry.lockedUntil && now < entry.lockedUntil) return;

    slideWindow(entry, now);
    entry.attempts.push(now);

    if (entry.attempts.length >= maxAttempts) {
      entry.lockedUntil = now + lockoutMs;
    }
  }

  function reset(rawIp: string | undefined): void {
    const ip = normalizeKey(rawIp);
    entries.delete(ip);
  }

  function prune(): void {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.lockedUntil && now < entry.lockedUntil) continue;
      slideWindow(entry, now);
      if (entry.attempts.length === 0) {
        entries.delete(key);
      }
    }
  }

  function size(): number {
    return entries.size;
  }

  function dispose(): void {
    clearInterval(pruneTimer);
    entries.clear();
  }

  return { check, recordFailure, reset, size, prune, dispose };
}
