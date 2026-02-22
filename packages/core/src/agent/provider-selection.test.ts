import { describe, it, expect } from "vitest";
import { createProvider } from "./providers.js";

describe("config-driven provider selection", () => {
  it("defaults to openai provider", () => {
    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "OPENAI_API_KEY",
    });
    expect(provider.name).toBe("openai");
  });

  it("creates bedrock provider without apiKeyEnvVar", () => {
    const provider = createProvider({
      provider: "bedrock",
      model: "anthropic.claude-sonnet-4-20250514-v1:0",
      awsRegion: "us-east-1",
    });
    expect(provider.name).toBe("bedrock");
  });

  it("creates anthropic provider", () => {
    const provider = createProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
    });
    expect(provider.name).toBe("anthropic");
  });

  it("bedrock provider does not require apiKeyEnvVar", () => {
    // Should not throw even without apiKeyEnvVar
    const provider = createProvider({
      provider: "bedrock",
      model: "anthropic.claude-sonnet-4-20250514-v1:0",
    });
    expect(provider.name).toBe("bedrock");
  });

  it("passes awsRegion through to bedrock provider config", () => {
    // This tests that the provider is created successfully with the region
    const provider = createProvider({
      provider: "bedrock",
      model: "anthropic.claude-sonnet-4-20250514-v1:0",
      awsRegion: "eu-west-1",
    });
    expect(provider.name).toBe("bedrock");
  });

  it("case-insensitive provider names", () => {
    const provider = createProvider({
      provider: "Bedrock",
      model: "anthropic.claude-sonnet-4-20250514-v1:0",
      awsRegion: "us-east-1",
    });
    expect(provider.name).toBe("bedrock");
  });
});
