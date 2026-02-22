import { describe, expect, it } from "vitest";
import { BudgetEnforcer, BudgetExceededError } from "./budget.js";
import type { UsageTracker } from "./usage.js";

/**
 * Create a mock UsageTracker with configurable return values.
 */
function mockTracker(opts: {
  sessionTokens?: number;
  dailyTokens?: number;
  dailyRequests?: number;
}): UsageTracker {
  return {
    getSessionUsage: () => ({
      totalTokens: opts.sessionTokens ?? 0,
      records: [],
    }),
    getTotalUsage: () => ({
      totalTokens: opts.dailyTokens ?? 0,
      promptTokens: 0,
      completionTokens: 0,
      requestCount: opts.dailyRequests ?? 0,
    }),
  } as unknown as UsageTracker;
}

describe("BudgetEnforcer", () => {
  it("does not throw when no limits are configured", () => {
    const tracker = mockTracker({
      sessionTokens: 999999,
      dailyTokens: 999999,
      dailyRequests: 999999,
    });
    const enforcer = new BudgetEnforcer(tracker, {});

    expect(() => enforcer.enforce("s1")).not.toThrow();
  });

  it("does not throw when usage is within all limits", () => {
    const tracker = mockTracker({
      sessionTokens: 100,
      dailyTokens: 500,
      dailyRequests: 5,
    });
    const enforcer = new BudgetEnforcer(tracker, {
      maxTokensPerSession: 1000,
      maxTokensPerDay: 10000,
      maxRequestsPerDay: 100,
    });

    expect(() => enforcer.enforce("s1")).not.toThrow();
  });

  it("throws BudgetExceededError when session token limit is exceeded", () => {
    const tracker = mockTracker({ sessionTokens: 5000 });
    const enforcer = new BudgetEnforcer(tracker, {
      maxTokensPerSession: 1000,
    });

    expect(() => enforcer.enforce("s1")).toThrow(BudgetExceededError);
    expect(() => enforcer.enforce("s1")).toThrow(/Session token budget exceeded/);
  });

  it("throws BudgetExceededError when session token limit is exactly met", () => {
    const tracker = mockTracker({ sessionTokens: 1000 });
    const enforcer = new BudgetEnforcer(tracker, {
      maxTokensPerSession: 1000,
    });

    expect(() => enforcer.enforce("s1")).toThrow(BudgetExceededError);
  });

  it("throws BudgetExceededError when daily token limit is exceeded", () => {
    const tracker = mockTracker({ dailyTokens: 50000 });
    const enforcer = new BudgetEnforcer(tracker, {
      maxTokensPerDay: 10000,
    });

    expect(() => enforcer.enforce("s1")).toThrow(BudgetExceededError);
    expect(() => enforcer.enforce("s1")).toThrow(/Daily token budget exceeded/);
  });

  it("throws BudgetExceededError when daily request limit is exceeded", () => {
    const tracker = mockTracker({ dailyRequests: 200 });
    const enforcer = new BudgetEnforcer(tracker, {
      maxRequestsPerDay: 100,
    });

    expect(() => enforcer.enforce("s1")).toThrow(BudgetExceededError);
    expect(() => enforcer.enforce("s1")).toThrow(/Daily request budget exceeded/);
  });

  it("BudgetExceededError has correct properties", () => {
    const tracker = mockTracker({ sessionTokens: 5000 });
    const enforcer = new BudgetEnforcer(tracker, {
      maxTokensPerSession: 1000,
    });

    try {
      enforcer.enforce("test-session");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      const err = e as BudgetExceededError;
      expect(err.sessionId).toBe("test-session");
      expect(err.code).toBe("BUDGET_EXCEEDED");
      expect(err.statusCode).toBe(429);
      expect(err.name).toBe("BudgetExceededError");
    }
  });

  it("checks session limit before daily limits", () => {
    const tracker = mockTracker({
      sessionTokens: 5000,
      dailyTokens: 50000,
      dailyRequests: 200,
    });
    const enforcer = new BudgetEnforcer(tracker, {
      maxTokensPerSession: 1000,
      maxTokensPerDay: 10000,
      maxRequestsPerDay: 100,
    });

    // Should throw session-level error first
    expect(() => enforcer.enforce("s1")).toThrow(/Session token budget exceeded/);
  });
});
