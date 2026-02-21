import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTeamsConfig, requireEnv } from "./config.js";

describe("resolveTeamsConfig", () => {
  it("returns defaults when settings is empty", () => {
    const config = resolveTeamsConfig({});

    expect(config.appIdEnvVar).toBe("TEAMS_APP_ID");
    expect(config.appPasswordEnvVar).toBe("TEAMS_APP_PASSWORD");
    expect(config.tenantIdEnvVar).toBe("TEAMS_TENANT_ID");
  });

  it("uses custom env var names from settings", () => {
    const config = resolveTeamsConfig({
      appIdEnvVar: "MY_APP_ID",
      appPasswordEnvVar: "MY_APP_PASSWORD",
      tenantIdEnvVar: "MY_TENANT_ID",
    });

    expect(config.appIdEnvVar).toBe("MY_APP_ID");
    expect(config.appPasswordEnvVar).toBe("MY_APP_PASSWORD");
    expect(config.tenantIdEnvVar).toBe("MY_TENANT_ID");
  });

  it("ignores non-string settings values", () => {
    const config = resolveTeamsConfig({
      appIdEnvVar: 123,
      appPasswordEnvVar: true,
    });

    expect(config.appIdEnvVar).toBe("TEAMS_APP_ID");
    expect(config.appPasswordEnvVar).toBe("TEAMS_APP_PASSWORD");
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
