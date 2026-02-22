import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveLineConfig, requireEnv } from "./config.js";

describe("resolveLineConfig", () => {
  it("returns defaults when settings is empty", () => {
    const config = resolveLineConfig({});

    expect(config.channelAccessTokenEnvVar).toBe("LINE_CHANNEL_ACCESS_TOKEN");
    expect(config.channelSecretEnvVar).toBe("LINE_CHANNEL_SECRET");
  });

  it("uses custom env var names from settings", () => {
    const config = resolveLineConfig({
      channelAccessTokenEnvVar: "MY_LINE_TOKEN",
      channelSecretEnvVar: "MY_LINE_SECRET",
    });

    expect(config.channelAccessTokenEnvVar).toBe("MY_LINE_TOKEN");
    expect(config.channelSecretEnvVar).toBe("MY_LINE_SECRET");
  });

  it("ignores non-string settings values", () => {
    const config = resolveLineConfig({
      channelAccessTokenEnvVar: 123,
      channelSecretEnvVar: true,
    });

    expect(config.channelAccessTokenEnvVar).toBe("LINE_CHANNEL_ACCESS_TOKEN");
    expect(config.channelSecretEnvVar).toBe("LINE_CHANNEL_SECRET");
  });

  it("partially overrides settings", () => {
    const config = resolveLineConfig({
      channelAccessTokenEnvVar: "CUSTOM_TOKEN",
    });

    expect(config.channelAccessTokenEnvVar).toBe("CUSTOM_TOKEN");
    expect(config.channelSecretEnvVar).toBe("LINE_CHANNEL_SECRET");
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
