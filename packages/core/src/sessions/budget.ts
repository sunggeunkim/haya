import { AppError } from "../infra/errors.js";
import type { UsageTracker } from "./usage.js";

export class BudgetExceededError extends AppError {
  constructor(
    message: string,
    public readonly sessionId: string,
  ) {
    super(message, "BUDGET_EXCEEDED", 429);
    this.name = "BudgetExceededError";
  }
}

export interface BudgetLimits {
  maxTokensPerSession?: number;
  maxTokensPerDay?: number;
  maxRequestsPerDay?: number;
}

/**
 * Returns the Unix timestamp for midnight (start of day) of the current day.
 */
function startOfDay(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Enforces per-session and daily budget limits by checking recorded usage
 * against configured thresholds.
 */
export class BudgetEnforcer {
  constructor(
    private readonly tracker: UsageTracker,
    private readonly limits: BudgetLimits,
  ) {}

  /**
   * Check whether the session is within budget.
   * Throws BudgetExceededError if any limit is exceeded.
   */
  enforce(sessionId: string): void {
    // Check session token limit
    if (this.limits.maxTokensPerSession !== undefined) {
      const sessionUsage = this.tracker.getSessionUsage(sessionId);
      if (sessionUsage.totalTokens >= this.limits.maxTokensPerSession) {
        throw new BudgetExceededError(
          `Session token budget exceeded: ${sessionUsage.totalTokens} >= ${this.limits.maxTokensPerSession}`,
          sessionId,
        );
      }
    }

    // Check daily token limit
    if (this.limits.maxTokensPerDay !== undefined) {
      const dailyUsage = this.tracker.getTotalUsage(startOfDay());
      if (dailyUsage.totalTokens >= this.limits.maxTokensPerDay) {
        throw new BudgetExceededError(
          `Daily token budget exceeded: ${dailyUsage.totalTokens} >= ${this.limits.maxTokensPerDay}`,
          sessionId,
        );
      }
    }

    // Check daily request limit
    if (this.limits.maxRequestsPerDay !== undefined) {
      const dailyUsage = this.tracker.getTotalUsage(startOfDay());
      if (dailyUsage.requestCount >= this.limits.maxRequestsPerDay) {
        throw new BudgetExceededError(
          `Daily request budget exceeded: ${dailyUsage.requestCount} >= ${this.limits.maxRequestsPerDay}`,
          sessionId,
        );
      }
    }
  }
}
