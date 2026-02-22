import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTelegramConfig, requireEnv } from "./config.js";

describe("resolveTelegramConfig", () => {
  it("returns defaults when settings is empty", () => {
    const config = resolveTelegramConfig({});

    expect(config.botTokenEnvVar).toBe("TELEGRAM_BOT_TOKEN");
  });

  it("uses custom env var names from settings", () => {
    const config = resolveTelegramConfig({
      botTokenEnvVar: "MY_TELEGRAM_TOKEN",
    });

    expect(config.botTokenEnvVar).toBe("MY_TELEGRAM_TOKEN");
  });

  it("ignores non-string settings values", () => {
    const config = resolveTelegramConfig({
      botTokenEnvVar: 123,
    });

    expect(config.botTokenEnvVar).toBe("TELEGRAM_BOT_TOKEN");
  });
});

describe("requireEnv", () => {
  const ENV_KEY = "HAYA_TEST_REQUIRE_ENV";

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns the value when env var is set", () => {
    process.env[ENV_KEY] = "test-value";
    expect(requireEnv(ENV_KEY)).toBe("test-value");
  });

  it("throws when env var is not set", () => {
    expect(() => requireEnv(ENV_KEY)).toThrow("not set");
  });

  it("throws when env var is empty string", () => {
    process.env[ENV_KEY] = "";
    expect(() => requireEnv(ENV_KEY)).toThrow("not set");
  });
});
