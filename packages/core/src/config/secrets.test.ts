import { afterEach, describe, expect, it, vi } from "vitest";
import { requireSecret, resolveSecret } from "./secrets.js";

describe("resolveSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns env var value when set", () => {
    vi.stubEnv("TEST_API_KEY", "my-secret-value");
    expect(resolveSecret("TEST_API_KEY")).toBe("my-secret-value");
  });

  it("returns undefined when env var is not set", () => {
    expect(resolveSecret("NONEXISTENT_VAR_XYZ")).toBeUndefined();
  });

  it("throws on invalid env var names", () => {
    expect(() => resolveSecret("invalid-name")).toThrow(/Invalid env var name/);
    expect(() => resolveSecret("123_STARTS_WITH_NUMBER")).toThrow(
      /Invalid env var name/,
    );
    expect(() => resolveSecret("")).toThrow(/Invalid env var name/);
    expect(() => resolveSecret("has spaces")).toThrow(/Invalid env var name/);
  });

  it("accepts valid env var names", () => {
    vi.stubEnv("VALID_NAME_123", "value");
    expect(resolveSecret("VALID_NAME_123")).toBe("value");
  });
});

describe("requireSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns value when env var is set and non-empty", () => {
    vi.stubEnv("REQUIRED_KEY", "value");
    expect(requireSecret("REQUIRED_KEY")).toBe("value");
  });

  it("throws when env var is not set", () => {
    expect(() => requireSecret("MISSING_KEY_XYZ")).toThrow(
      /not set or empty/,
    );
  });

  it("throws when env var is empty string", () => {
    vi.stubEnv("EMPTY_KEY", "");
    expect(() => requireSecret("EMPTY_KEY")).toThrow(/not set or empty/);
  });
});
