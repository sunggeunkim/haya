import { describe, expect, it } from "vitest";
import type { AssistantConfig } from "./types.js";
import { ConfigValidationError, validateConfig } from "./validation.js";

function makeConfig(overrides: Record<string, unknown> = {}): AssistantConfig {
  const base: AssistantConfig = {
    gateway: {
      port: 18789,
      bind: "loopback",
      auth: { mode: "token", token: "a".repeat(64) },
      trustedProxies: [],
    },
    agent: {
      defaultModel: "gpt-4o",
      defaultProviderApiKeyEnvVar: "OPENAI_API_KEY",
      systemPrompt:
        "You are a helpful assistant responding to users in a chat conversation. Reply directly and concisely.",
      maxHistoryMessages: 100,
      toolPolicies: [],
    },
    cron: [],
    plugins: [],
  };

  return { ...base, ...overrides } as AssistantConfig;
}

describe("validateConfig", () => {
  it("passes for valid loopback config without TLS", () => {
    expect(() => validateConfig(makeConfig())).not.toThrow();
  });

  it("requires TLS for lan bind", () => {
    const config = makeConfig({
      gateway: {
        port: 18789,
        bind: "lan",
        auth: { mode: "token", token: "a".repeat(64) },
        trustedProxies: [],
      },
    });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/TLS must be enabled/);
  });

  it("requires TLS for custom bind", () => {
    const config = makeConfig({
      gateway: {
        port: 18789,
        bind: "custom",
        auth: { mode: "token", token: "a".repeat(64) },
        trustedProxies: [],
      },
    });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it("passes for lan bind with TLS enabled", () => {
    const config = makeConfig({
      gateway: {
        port: 18789,
        bind: "lan",
        auth: { mode: "token", token: "a".repeat(64) },
        tls: { enabled: true, certPath: "/path/cert.pem", keyPath: "/path/key.pem" },
        trustedProxies: [],
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("requires cert and key paths when TLS is enabled", () => {
    const config = makeConfig({
      gateway: {
        port: 18789,
        bind: "lan",
        auth: { mode: "token", token: "a".repeat(64) },
        tls: { enabled: true },
        trustedProxies: [],
      },
    });
    try {
      validateConfig(config);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const err = e as ConfigValidationError;
      expect(err.errors).toContain(
        "gateway.tls.certPath is required when TLS is enabled.",
      );
      expect(err.errors).toContain(
        "gateway.tls.keyPath is required when TLS is enabled.",
      );
    }
  });

  it("rejects invalid trusted proxy addresses", () => {
    const config = makeConfig({
      gateway: {
        port: 18789,
        bind: "loopback",
        auth: { mode: "token", token: "a".repeat(64) },
        trustedProxies: ["not-an-ip"],
      },
    });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/Invalid trustedProxy address/);
  });

  it("accepts valid IPv4 trusted proxies", () => {
    const config = makeConfig({
      gateway: {
        port: 18789,
        bind: "loopback",
        auth: { mode: "token", token: "a".repeat(64) },
        trustedProxies: ["192.168.1.1", "10.0.0.0/8"],
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("accepts valid IPv6 trusted proxies", () => {
    const config = makeConfig({
      gateway: {
        port: 18789,
        bind: "loopback",
        auth: { mode: "token", token: "a".repeat(64) },
        trustedProxies: ["::1", "fe80::1/64"],
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });
});
