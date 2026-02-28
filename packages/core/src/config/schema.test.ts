import { describe, expect, it } from "vitest";
import { AssistantConfigSchema, CronJobSchema, FinanceConfigSchema, FlightConfigSchema, GatewayAuthSchema, LoggingSchema, ToolsConfigSchema, WebSearchConfigSchema } from "./schema.js";

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

  it("accepts stockQuote with valid providers", () => {
    const result = ToolsConfigSchema.safeParse({
      stockQuote: [
        { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
        { provider: "alphavantage", apiKeyEnvVar: "AV_KEY" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects stockQuote with empty array", () => {
    const result = ToolsConfigSchema.safeParse({
      stockQuote: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects stockQuote with unknown provider", () => {
    const result = ToolsConfigSchema.safeParse({
      stockQuote: [{ provider: "unknown", apiKeyEnvVar: "KEY" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts config without stockQuote (optional)", () => {
    const result = ToolsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts flightSearch with valid providers", () => {
    const result = ToolsConfigSchema.safeParse({
      flightSearch: [
        { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
        { provider: "amadeus", apiKeyEnvVar: "AMADEUS_ID", apiSecretEnvVar: "AMADEUS_SECRET", environment: "test" },
        { provider: "tequila", apiKeyEnvVar: "TEQUILA_KEY" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects flightSearch with empty array", () => {
    const result = ToolsConfigSchema.safeParse({
      flightSearch: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects flightSearch with unknown provider", () => {
    const result = ToolsConfigSchema.safeParse({
      flightSearch: [{ provider: "kayak", apiKeyEnvVar: "KEY" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts config without flightSearch (optional)", () => {
    const result = ToolsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts youtube with apiKeyEnvVar", () => {
    const result = ToolsConfigSchema.safeParse({
      youtube: { apiKeyEnvVar: "YOUTUBE_API_KEY" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects youtube without apiKeyEnvVar", () => {
    const result = ToolsConfigSchema.safeParse({
      youtube: {},
    });
    expect(result.success).toBe(false);
  });

  it("accepts config without youtube (optional)", () => {
    const result = ToolsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("FinanceConfigSchema", () => {
  it("accepts an array with one provider", () => {
    const result = FinanceConfigSchema.safeParse([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts yfinance provider without apiKeyEnvVar", () => {
    const result = FinanceConfigSchema.safeParse([
      { provider: "yfinance" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts an array with multiple providers (fallback chain)", () => {
    const result = FinanceConfigSchema.safeParse([
      { provider: "yfinance" },
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
      { provider: "alphavantage", apiKeyEnvVar: "AV_KEY" },
      { provider: "twelvedata", apiKeyEnvVar: "TD_KEY" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an empty array", () => {
    const result = FinanceConfigSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects a single object (must be an array)", () => {
    const result = FinanceConfigSchema.safeParse({
      provider: "yahoo",
      apiKeyEnvVar: "RAPIDAPI_KEY",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entry with an unknown provider", () => {
    const result = FinanceConfigSchema.safeParse([
      { provider: "bloomberg", apiKeyEnvVar: "BB_KEY" },
    ]);
    expect(result.success).toBe(false);
  });
});

describe("FlightConfigSchema", () => {
  it("accepts an array with one provider", () => {
    const result = FlightConfigSchema.safeParse([
      { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts an array with multiple providers (fallback chain)", () => {
    const result = FlightConfigSchema.safeParse([
      { provider: "serpapi", apiKeyEnvVar: "SERPAPI_KEY" },
      { provider: "amadeus", apiKeyEnvVar: "AMADEUS_ID", apiSecretEnvVar: "AMADEUS_SECRET" },
      { provider: "tequila", apiKeyEnvVar: "TEQUILA_KEY" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts amadeus with environment option", () => {
    const result = FlightConfigSchema.safeParse([
      { provider: "amadeus", apiKeyEnvVar: "ID", apiSecretEnvVar: "SECRET", environment: "production" },
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].environment).toBe("production");
    }
  });

  it("rejects an empty array", () => {
    const result = FlightConfigSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects a single object (must be an array)", () => {
    const result = FlightConfigSchema.safeParse({
      provider: "serpapi",
      apiKeyEnvVar: "KEY",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entry with an unknown provider", () => {
    const result = FlightConfigSchema.safeParse([
      { provider: "kayak", apiKeyEnvVar: "KEY" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects an entry without apiKeyEnvVar", () => {
    const result = FlightConfigSchema.safeParse([
      { provider: "serpapi" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects invalid environment value", () => {
    const result = FlightConfigSchema.safeParse([
      { provider: "amadeus", apiKeyEnvVar: "ID", environment: "staging" },
    ]);
    expect(result.success).toBe(false);
  });
});

describe("CronJobSchema", () => {
  it("accepts a cron job without metadata", () => {
    const result = CronJobSchema.safeParse({
      name: "test-job",
      schedule: "0 * * * *",
      action: "prune_sessions",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toBeUndefined();
    }
  });

  it("accepts a cron job with metadata", () => {
    const result = CronJobSchema.safeParse({
      name: "briefing",
      schedule: "0 7 * * *",
      action: "agent_prompt",
      metadata: { prompt: "Good morning!", model: "gpt-4o" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({ prompt: "Good morning!", model: "gpt-4o" });
    }
  });

  it("defaults enabled to true", () => {
    const result = CronJobSchema.parse({
      name: "test",
      schedule: "0 * * * *",
      action: "test",
    });
    expect(result.enabled).toBe(true);
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

describe("LoggingSchema", () => {
  it("applies correct defaults for new logging fields", () => {
    const result = LoggingSchema.parse({});
    expect(result.dir).toBe("data/logs");
    expect(result.maxSizeMB).toBe(10);
    expect(result.maxFiles).toBe(5);
  });

  it("rejects maxSizeMB less than 1", () => {
    const result = LoggingSchema.safeParse({ maxSizeMB: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects maxFiles less than 1", () => {
    const result = LoggingSchema.safeParse({ maxFiles: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects maxFiles greater than 100", () => {
    const result = LoggingSchema.safeParse({ maxFiles: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer maxFiles", () => {
    const result = LoggingSchema.safeParse({ maxFiles: 3.5 });
    expect(result.success).toBe(false);
  });

  it("accepts custom values for all logging fields", () => {
    const result = LoggingSchema.parse({
      level: "debug",
      redactSecrets: false,
      dir: "/var/log/haya",
      maxSizeMB: 50,
      maxFiles: 20,
    });
    expect(result.dir).toBe("/var/log/haya");
    expect(result.maxSizeMB).toBe(50);
    expect(result.maxFiles).toBe(20);
  });
});
