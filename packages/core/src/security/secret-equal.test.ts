import { describe, expect, it } from "vitest";
import { safeEqualSecret } from "./secret-equal.js";

describe("safeEqualSecret", () => {
  it("returns true for identical strings", () => {
    expect(safeEqualSecret("my-secret-token", "my-secret-token")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(safeEqualSecret("secret-a", "secret-b")).toBe(false);
  });

  it("returns false for different length strings", () => {
    expect(safeEqualSecret("short", "a-much-longer-secret-value")).toBe(false);
  });

  it("returns false when provided is null", () => {
    expect(safeEqualSecret(null, "expected")).toBe(false);
  });

  it("returns false when expected is null", () => {
    expect(safeEqualSecret("provided", null)).toBe(false);
  });

  it("returns false when both are null", () => {
    expect(safeEqualSecret(null, null)).toBe(false);
  });

  it("returns false when provided is undefined", () => {
    expect(safeEqualSecret(undefined, "expected")).toBe(false);
  });

  it("returns false when expected is undefined", () => {
    expect(safeEqualSecret("provided", undefined)).toBe(false);
  });

  it("returns true for empty strings (edge case)", () => {
    expect(safeEqualSecret("", "")).toBe(true);
  });

  it("handles unicode correctly", () => {
    expect(safeEqualSecret("hello-\u00e9", "hello-\u00e9")).toBe(true);
    expect(safeEqualSecret("hello-\u00e9", "hello-e")).toBe(false);
  });

  it("handles very long strings", () => {
    const long = "x".repeat(10000);
    expect(safeEqualSecret(long, long)).toBe(true);
    expect(safeEqualSecret(long, long + "y")).toBe(false);
  });
});
