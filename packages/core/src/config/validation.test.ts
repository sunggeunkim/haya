import { afterEach, describe, expect, it, vi } from "vitest";
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
        "You are a friendly personal assistant. Keep replies short — 1-3 sentences. Use a warm, casual tone. When something is ambiguous, make your best guess and go with it rather than asking clarifying questions. If a topic is complex, break it into a back-and-forth dialogue rather than a single long answer.",
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

describe("validateConfig — provider-specific validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("errors when bedrock provider has no awsRegion and no AWS_REGION env var", () => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;

    const config = makeConfig({
      agent: {
        defaultProvider: "bedrock",
        defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
        systemPrompt: "You are helpful.",
        maxHistoryMessages: 100,
        toolPolicies: [],
      },
    });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/AWS region/);
  });

  it("passes when bedrock provider has awsRegion in config", () => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;

    const config = makeConfig({
      agent: {
        defaultProvider: "bedrock",
        defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
        awsRegion: "us-east-1",
        systemPrompt: "You are helpful.",
        maxHistoryMessages: 100,
        toolPolicies: [],
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("passes when bedrock provider has AWS_REGION env var", () => {
    vi.stubEnv("AWS_REGION", "us-west-2");

    const config = makeConfig({
      agent: {
        defaultProvider: "bedrock",
        defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
        systemPrompt: "You are helpful.",
        maxHistoryMessages: 100,
        toolPolicies: [],
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("passes when bedrock provider has AWS_DEFAULT_REGION env var", () => {
    vi.stubEnv("AWS_DEFAULT_REGION", "eu-west-1");

    const config = makeConfig({
      agent: {
        defaultProvider: "bedrock",
        defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
        systemPrompt: "You are helpful.",
        maxHistoryMessages: 100,
        toolPolicies: [],
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("errors when non-bedrock provider is missing defaultProviderApiKeyEnvVar", () => {
    const config = makeConfig({
      agent: {
        defaultProvider: "openai",
        defaultModel: "gpt-4o",
        systemPrompt: "You are helpful.",
        maxHistoryMessages: 100,
        toolPolicies: [],
      },
    });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/defaultProviderApiKeyEnvVar/);
  });

  it("errors when provider defaults to openai and apiKeyEnvVar is missing", () => {
    const config = makeConfig({
      agent: {
        defaultModel: "gpt-4o",
        systemPrompt: "You are helpful.",
        maxHistoryMessages: 100,
        toolPolicies: [],
      },
    });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/requires agent.defaultProviderApiKeyEnvVar/);
  });

  it("passes when non-bedrock provider has defaultProviderApiKeyEnvVar set", () => {
    const config = makeConfig({
      agent: {
        defaultProvider: "anthropic",
        defaultModel: "claude-sonnet-4-20250514",
        defaultProviderApiKeyEnvVar: "ANTHROPIC_API_KEY",
        systemPrompt: "You are helpful.",
        maxHistoryMessages: 100,
        toolPolicies: [],
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });
});
