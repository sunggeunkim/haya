import { describe, expect, it } from "vitest";
import { AssistantConfigSchema, GatewayAuthSchema, ToolsConfigSchema, WebSearchConfigSchema } from "./schema.js";

describe("GatewayAuthSchema", () => {
  it("accepts valid token auth", () => {
    const result = GatewayAuthSchema.safeParse({
      mode: "token",
      token: "a".repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid password auth", () => {
    const result = GatewayAuthSchema.safeParse({
      mode: "password",
      password: "a".repeat(16),
    });
    expect(result.success).toBe(true);
  });

  it("rejects token shorter than 32 chars", () => {
    const result = GatewayAuthSchema.safeParse({
      mode: "token",
      token: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects password shorter than 16 chars", () => {
    const result = GatewayAuthSchema.safeParse({
      mode: "password",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects token mode without token", () => {
    const result = GatewayAuthSchema.safeParse({
      mode: "token",
    });
    expect(result.success).toBe(false);
  });

  it("rejects password mode without password", () => {
    const result = GatewayAuthSchema.safeParse({
      mode: "password",
    });
    expect(result.success).toBe(false);
  });

  it('does NOT accept "none" auth mode', () => {
    const result = GatewayAuthSchema.safeParse({
      mode: "none",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown auth modes", () => {
    const result = GatewayAuthSchema.safeParse({
      mode: "oauth",
      token: "a".repeat(32),
    });
    expect(result.success).toBe(false);
  });
});

describe("WebSearchConfigSchema", () => {
  it("accepts an array with one provider", () => {
    const result = WebSearchConfigSchema.safeParse([
      { provider: "brave", apiKeyEnvVar: "BRAVE_API_KEY" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts an array with multiple providers (fallback chain)", () => {
    const result = WebSearchConfigSchema.safeParse([
      { provider: "google", apiKeyEnvVar: "GOOGLE_KEY", searchEngineId: "cse-id" },
      { provider: "brave", apiKeyEnvVar: "BRAVE_KEY" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an empty array", () => {
    const result = WebSearchConfigSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects a single object (must be an array)", () => {
    const result = WebSearchConfigSchema.safeParse({
      provider: "brave",
      apiKeyEnvVar: "BRAVE_API_KEY",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entry with an unknown provider", () => {
    const result = WebSearchConfigSchema.safeParse([
      { provider: "bing", apiKeyEnvVar: "BING_KEY" },
    ]);
    expect(result.success).toBe(false);
  });
});

describe("ToolsConfigSchema", () => {
  it("accepts twitterSearch with apiKeyEnvVar", () => {
    const result = ToolsConfigSchema.safeParse({
      twitterSearch: { apiKeyEnvVar: "TWITTER_BEARER_TOKEN" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects twitterSearch without apiKeyEnvVar", () => {
    const result = ToolsConfigSchema.safeParse({
      twitterSearch: {},
    });
    expect(result.success).toBe(false);
  });

  it("accepts config without twitterSearch (optional)", () => {
    const result = ToolsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("AssistantConfigSchema", () => {
  const validConfig = {
    gateway: {
      port: 18789,
      bind: "loopback",
      auth: {
        mode: "token",
        token: "a".repeat(64),
      },
    },
    agent: {
      defaultModel: "gpt-4o",
      defaultProviderApiKeyEnvVar: "OPENAI_API_KEY",
    },
  };

  it("accepts a valid minimal config", () => {
    const result = AssistantConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("applies defaults for optional fields", () => {
    const result = AssistantConfigSchema.parse(validConfig);
    expect(result.gateway.trustedProxies).toEqual([]);
    expect(result.cron).toEqual([]);
    expect(result.plugins).toEqual([]);
    expect(result.agent.maxHistoryMessages).toBe(100);
  });

  it("rejects invalid port numbers", () => {
    const result = AssistantConfigSchema.safeParse({
      ...validConfig,
      gateway: { ...validConfig.gateway, port: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects port > 65535", () => {
    const result = AssistantConfigSchema.safeParse({
      ...validConfig,
      gateway: { ...validConfig.gateway, port: 70000 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects config without auth", () => {
    const result = AssistantConfigSchema.safeParse({
      gateway: {
        port: 18789,
        bind: "loopback",
      },
      agent: {
        defaultProviderApiKeyEnvVar: "OPENAI_API_KEY",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts config without agent.defaultProviderApiKeyEnvVar (optional)", () => {
    const result = AssistantConfigSchema.safeParse({
      gateway: {
        auth: {
          mode: "token",
          token: "a".repeat(32),
        },
      },
      agent: {
        defaultModel: "gpt-4o",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts full config with all optional fields", () => {
    const result = AssistantConfigSchema.safeParse({
      ...validConfig,
      memory: { enabled: true, dbPath: "/tmp/memory.db" },
      cron: [
        { name: "test", schedule: "0 * * * *", action: "test-action" },
      ],
      plugins: ["my-plugin"],
      logging: { level: "debug", redactSecrets: true },
    });
    expect(result.success).toBe(true);
  });

  it("defaults defaultProvider to openai when not specified", () => {
    const result = AssistantConfigSchema.parse(validConfig);
    expect(result.agent.defaultProvider).toBe("openai");
  });

  it("accepts config with defaultProvider set to bedrock", () => {
    const result = AssistantConfigSchema.safeParse({
      ...validConfig,
      agent: {
        defaultProvider: "bedrock",
        defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts config with awsRegion", () => {
    const result = AssistantConfigSchema.parse({
      ...validConfig,
      agent: { ...validConfig.agent, awsRegion: "us-east-1" },
    });
    expect(result.agent.awsRegion).toBe("us-east-1");
  });

  it("awsRegion defaults to undefined when not specified", () => {
    const result = AssistantConfigSchema.parse(validConfig);
    expect(result.agent.awsRegion).toBeUndefined();
  });
});
