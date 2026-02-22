import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveMattermostConfig, requireEnv, optionalEnv } from "./config.js";

describe("resolveMattermostConfig", () => {
  it("returns defaults when settings is empty", () => {
    const config = resolveMattermostConfig({});

    expect(config.serverUrlEnvVar).toBe("MATTERMOST_SERVER_URL");
    expect(config.accessTokenEnvVar).toBe("MATTERMOST_ACCESS_TOKEN");
    expect(config.botUsernameEnvVar).toBe("MATTERMOST_BOT_USERNAME");
  });

  it("uses custom env var names from settings", () => {
    const config = resolveMattermostConfig({
      serverUrlEnvVar: "MY_SERVER_URL",
      accessTokenEnvVar: "MY_ACCESS_TOKEN",
      botUsernameEnvVar: "MY_BOT_USERNAME",
    });

    expect(config.serverUrlEnvVar).toBe("MY_SERVER_URL");
    expect(config.accessTokenEnvVar).toBe("MY_ACCESS_TOKEN");
    expect(config.botUsernameEnvVar).toBe("MY_BOT_USERNAME");
  });

  it("ignores non-string settings values", () => {
    const config = resolveMattermostConfig({
      serverUrlEnvVar: 123,
      accessTokenEnvVar: true,
      botUsernameEnvVar: null,
    });

    expect(config.serverUrlEnvVar).toBe("MATTERMOST_SERVER_URL");
    expect(config.accessTokenEnvVar).toBe("MATTERMOST_ACCESS_TOKEN");
    expect(config.botUsernameEnvVar).toBe("MATTERMOST_BOT_USERNAME");
  });

  it("partially overrides settings", () => {
    const config = resolveMattermostConfig({
      serverUrlEnvVar: "CUSTOM_URL",
    });

    expect(config.serverUrlEnvVar).toBe("CUSTOM_URL");
    expect(config.accessTokenEnvVar).toBe("MATTERMOST_ACCESS_TOKEN");
    expect(config.botUsernameEnvVar).toBe("MATTERMOST_BOT_USERNAME");
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

describe("optionalEnv", () => {
  const ENV_KEY = "HAYA_TEST_OPTIONAL_ENV";

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns the value when env var is set", () => {
    process.env[ENV_KEY] = "test-value";
    expect(optionalEnv(ENV_KEY)).toBe("test-value");
  });

  it("returns undefined when env var is not set", () => {
    expect(optionalEnv(ENV_KEY)).toBeUndefined();
  });

  it("returns undefined when env var is empty string", () => {
    process.env[ENV_KEY] = "";
    expect(optionalEnv(ENV_KEY)).toBeUndefined();
  });
});
