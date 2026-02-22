import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveMatrixConfig, requireEnv } from "./config.js";

describe("resolveMatrixConfig", () => {
  it("returns defaults when settings is empty", () => {
    const config = resolveMatrixConfig({});

    expect(config.homeserverUrlEnvVar).toBe("MATRIX_HOMESERVER_URL");
    expect(config.accessTokenEnvVar).toBe("MATRIX_ACCESS_TOKEN");
    expect(config.userIdEnvVar).toBe("MATRIX_USER_ID");
  });

  it("uses custom env var names from settings", () => {
    const config = resolveMatrixConfig({
      homeserverUrlEnvVar: "MY_HOMESERVER_URL",
      accessTokenEnvVar: "MY_ACCESS_TOKEN",
      userIdEnvVar: "MY_USER_ID",
    });

    expect(config.homeserverUrlEnvVar).toBe("MY_HOMESERVER_URL");
    expect(config.accessTokenEnvVar).toBe("MY_ACCESS_TOKEN");
    expect(config.userIdEnvVar).toBe("MY_USER_ID");
  });

  it("ignores non-string settings values", () => {
    const config = resolveMatrixConfig({
      homeserverUrlEnvVar: 123,
      accessTokenEnvVar: true,
      userIdEnvVar: null,
    });

    expect(config.homeserverUrlEnvVar).toBe("MATRIX_HOMESERVER_URL");
    expect(config.accessTokenEnvVar).toBe("MATRIX_ACCESS_TOKEN");
    expect(config.userIdEnvVar).toBe("MATRIX_USER_ID");
  });

  it("partially overrides settings", () => {
    const config = resolveMatrixConfig({
      homeserverUrlEnvVar: "CUSTOM_URL",
    });

    expect(config.homeserverUrlEnvVar).toBe("CUSTOM_URL");
    expect(config.accessTokenEnvVar).toBe("MATRIX_ACCESS_TOKEN");
    expect(config.userIdEnvVar).toBe("MATRIX_USER_ID");
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
