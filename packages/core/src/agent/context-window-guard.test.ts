import { describe, expect, it } from "vitest";
import {
  resolveContextWindow,
  evaluateContextWindowGuard,
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
} from "./context-window-guard.js";

describe("resolveContextWindow", () => {
  it("uses config value when provided", () => {
    const result = resolveContextWindow(64_000);
    expect(result).toEqual({ tokens: 64_000, source: "config" });
  });

  it("falls back to default when config is undefined", () => {
    const result = resolveContextWindow(undefined);
    expect(result).toEqual({ tokens: 128_000, source: "default" });
  });

  it("falls back to default when config is zero", () => {
    const result = resolveContextWindow(0);
    expect(result).toEqual({ tokens: 128_000, source: "default" });
  });

  it("falls back to default when config is negative", () => {
    const result = resolveContextWindow(-1);
    expect(result).toEqual({ tokens: 128_000, source: "default" });
  });

  it("floors fractional values", () => {
    const result = resolveContextWindow(64_000.9);
    expect(result).toEqual({ tokens: 64_000, source: "config" });
  });

  it("uses custom default when provided", () => {
    const result = resolveContextWindow(undefined, 200_000);
    expect(result).toEqual({ tokens: 200_000, source: "default" });
  });
});

describe("evaluateContextWindowGuard", () => {
  it("does not warn or block for large context windows", () => {
    const result = evaluateContextWindowGuard({
      info: { tokens: 128_000, source: "config" },
    });
    expect(result.shouldWarn).toBe(false);
    expect(result.shouldBlock).toBe(false);
  });

  it("warns for context windows below default warn threshold", () => {
    const result = evaluateContextWindowGuard({
      info: { tokens: 24_000, source: "config" },
    });
    expect(result.shouldWarn).toBe(true);
    expect(result.shouldBlock).toBe(false);
  });

  it("blocks for context windows below hard minimum", () => {
    const result = evaluateContextWindowGuard({
      info: { tokens: 8_000, source: "config" },
    });
    expect(result.shouldWarn).toBe(true);
    expect(result.shouldBlock).toBe(true);
  });

  it("does not warn at exactly the warn threshold", () => {
    const result = evaluateContextWindowGuard({
      info: { tokens: CONTEXT_WINDOW_WARN_BELOW_TOKENS, source: "config" },
    });
    expect(result.shouldWarn).toBe(false);
  });

  it("does not block at exactly the hard minimum", () => {
    const result = evaluateContextWindowGuard({
      info: { tokens: CONTEXT_WINDOW_HARD_MIN_TOKENS, source: "config" },
    });
    expect(result.shouldBlock).toBe(false);
  });

  it("accepts custom thresholds", () => {
    const result = evaluateContextWindowGuard({
      info: { tokens: 50_000, source: "config" },
      warnBelowTokens: 60_000,
      hardMinTokens: 40_000,
    });
    expect(result.shouldWarn).toBe(true);
    expect(result.shouldBlock).toBe(false);
  });

  it("preserves source from info", () => {
    const result = evaluateContextWindowGuard({
      info: { tokens: 128_000, source: "default" },
    });
    expect(result.source).toBe("default");
  });
});
