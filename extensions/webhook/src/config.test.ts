import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveWebhookConfig, requireEnv } from "./config.js";

describe("resolveWebhookConfig", () => {
  it("returns defaults when settings is empty", () => {
    const config = resolveWebhookConfig({});

    expect(config.port).toBe(9090);
    expect(config.path).toBe("/webhook");
    expect(config.maxPayloadBytes).toBe(1_048_576);
    expect(config.sources).toEqual([]);
  });

  it("uses custom values from settings", () => {
    const config = resolveWebhookConfig({
      port: 8080,
      path: "/hooks/incoming",
      maxPayloadBytes: 512_000,
      sources: [{ name: "github", secretEnvVar: "GITHUB_SECRET" }],
    });

    expect(config.port).toBe(8080);
    expect(config.path).toBe("/hooks/incoming");
    expect(config.maxPayloadBytes).toBe(512_000);
    expect(config.sources).toEqual([
      { name: "github", secretEnvVar: "GITHUB_SECRET" },
    ]);
  });

  it("ignores invalid setting types", () => {
    const config = resolveWebhookConfig({
      port: "not-a-number",
      path: 42,
      maxPayloadBytes: true,
      sources: "not-an-array",
    });

    expect(config.port).toBe(9090);
    expect(config.path).toBe("/webhook");
    expect(config.maxPayloadBytes).toBe(1_048_576);
    expect(config.sources).toEqual([]);
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
