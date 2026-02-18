import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveSlackConfig, requireEnv } from "./config.js";

describe("resolveSlackConfig", () => {
  it("returns defaults when settings is empty", () => {
    const config = resolveSlackConfig({});

    expect(config.botTokenEnvVar).toBe("SLACK_BOT_TOKEN");
    expect(config.appTokenEnvVar).toBe("SLACK_APP_TOKEN");
    expect(config.signingSecretEnvVar).toBe("SLACK_SIGNING_SECRET");
  });

  it("uses custom env var names from settings", () => {
    const config = resolveSlackConfig({
      botTokenEnvVar: "MY_BOT_TOKEN",
      appTokenEnvVar: "MY_APP_TOKEN",
      signingSecretEnvVar: "MY_SIGNING_SECRET",
    });

    expect(config.botTokenEnvVar).toBe("MY_BOT_TOKEN");
    expect(config.appTokenEnvVar).toBe("MY_APP_TOKEN");
    expect(config.signingSecretEnvVar).toBe("MY_SIGNING_SECRET");
  });

  it("ignores non-string settings values", () => {
    const config = resolveSlackConfig({
      botTokenEnvVar: 123,
      appTokenEnvVar: true,
    });

    expect(config.botTokenEnvVar).toBe("SLACK_BOT_TOKEN");
    expect(config.appTokenEnvVar).toBe("SLACK_APP_TOKEN");
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
