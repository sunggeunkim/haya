/**
 * Context window guard — validates that the configured context window
 * meets minimum thresholds and emits warnings for small windows.
 */

export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

export type ContextWindowSource = "config" | "default";

export interface ContextWindowInfo {
  tokens: number;
  source: ContextWindowSource;
}

export interface ContextWindowGuardResult extends ContextWindowInfo {
  shouldWarn: boolean;
  shouldBlock: boolean;
}

/**
 * Resolve the effective context window from config or default.
 */
export function resolveContextWindow(
  configTokens?: number,
  defaultTokens: number = 128_000,
): ContextWindowInfo {
  if (
    typeof configTokens === "number" &&
    Number.isFinite(configTokens) &&
    configTokens > 0
  ) {
    return { tokens: Math.floor(configTokens), source: "config" };
  }
  return { tokens: Math.floor(defaultTokens), source: "default" };
}

/**
 * Evaluate the context window against safety thresholds.
 *
 * - `shouldBlock`: Context window is below the hard minimum (16k tokens).
 *   The system should refuse to start.
 * - `shouldWarn`: Context window is below the warning threshold (32k tokens).
 *   The system should log a warning but can proceed.
 */
export function evaluateContextWindowGuard(params: {
  info: ContextWindowInfo;
  warnBelowTokens?: number;
  hardMinTokens?: number;
}): ContextWindowGuardResult {
  const warnBelow = Math.max(
    1,
    Math.floor(params.warnBelowTokens ?? CONTEXT_WINDOW_WARN_BELOW_TOKENS),
  );
  const hardMin = Math.max(
    1,
    Math.floor(params.hardMinTokens ?? CONTEXT_WINDOW_HARD_MIN_TOKENS),
  );
  const tokens = Math.max(0, Math.floor(params.info.tokens));

  return {
    ...params.info,
    tokens,
    shouldWarn: tokens > 0 && tokens < warnBelow,
    shouldBlock: tokens > 0 && tokens < hardMin,
  };
}
