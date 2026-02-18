import { describe, expect, it } from "vitest";
import { createLogger, redactSensitive } from "./logger.js";

describe("redactSensitive", () => {
  it("redacts token fields", () => {
    const result = redactSensitive({ token: "my-secret" });
    expect(result).toEqual({ token: "[REDACTED]" });
  });

  it("redacts password fields", () => {
    const result = redactSensitive({ password: "my-password" });
    expect(result).toEqual({ password: "[REDACTED]" });
  });

  it("redacts apiKey fields", () => {
    const result = redactSensitive({ apiKey: "sk-12345" });
    expect(result).toEqual({ apiKey: "[REDACTED]" });
  });

  it("redacts api_key fields", () => {
    const result = redactSensitive({ api_key: "sk-12345" });
    expect(result).toEqual({ api_key: "[REDACTED]" });
  });

  it("redacts nested sensitive fields", () => {
    const result = redactSensitive({
      config: {
        auth: {
          token: "secret-token",
          mode: "token",
        },
      },
    });
    expect(result).toEqual({
      config: {
        auth: {
          token: "[REDACTED]",
          mode: "token",
        },
      },
    });
  });

  it("preserves non-sensitive fields", () => {
    const result = redactSensitive({
      name: "test",
      port: 8080,
      enabled: true,
    });
    expect(result).toEqual({
      name: "test",
      port: 8080,
      enabled: true,
    });
  });

  it("handles arrays", () => {
    const result = redactSensitive([
      { token: "secret", name: "test" },
      { password: "pass", id: 1 },
    ]);
    expect(result).toEqual([
      { token: "[REDACTED]", name: "test" },
      { password: "[REDACTED]", id: 1 },
    ]);
  });

  it("handles null and undefined", () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
  });

  it("handles primitive values", () => {
    expect(redactSensitive("string")).toBe("string");
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(true)).toBe(true);
  });

  it("only redacts string values in sensitive keys", () => {
    const result = redactSensitive({
      token: 12345, // number, not a string
      password: null,
    });
    // Non-string values are not redacted (they could be config objects, etc.)
    expect(result).toEqual({ token: 12345, password: null });
  });

  it("is case-insensitive for key matching", () => {
    const result = redactSensitive({
      Token: "secret",
      API_KEY: "key",
      Password: "pass",
    });
    expect(result).toEqual({
      Token: "[REDACTED]",
      API_KEY: "[REDACTED]",
      Password: "[REDACTED]",
    });
  });
});

describe("createLogger", () => {
  it("creates a logger instance", () => {
    const logger = createLogger("test");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("creates a logger with custom level", () => {
    const logger = createLogger("test", { level: "debug" });
    expect(logger).toBeDefined();
  });

  it("creates a logger with redaction disabled", () => {
    const logger = createLogger("test", { redact: false });
    expect(logger).toBeDefined();
  });
});
