import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "./providers.js";

describe("createProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates an OpenAI provider", () => {
    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "OPENAI_API_KEY",
    });
    expect(provider.name).toBe("openai");
  });

  it("creates an Anthropic provider", () => {
    const provider = createProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
    });
    expect(provider.name).toBe("anthropic");
  });

  it("creates a custom provider with baseUrl", () => {
    const provider = createProvider({
      provider: "custom-llm",
      model: "custom-model",
      apiKeyEnvVar: "CUSTOM_KEY",
      baseUrl: "https://custom-api.example.com/v1",
    });
    expect(provider.name).toBe("custom-llm");
  });

  it("throws for unknown provider without baseUrl", () => {
    expect(() =>
      createProvider({
        provider: "unknown",
        model: "model",
        apiKeyEnvVar: "KEY",
      }),
    ).toThrow(/Unknown provider/);
  });

  it("throws when API key env var is not set", async () => {
    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnvVar: "NONEXISTENT_KEY_XYZ",
    });

    await expect(
      provider.complete({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key not found/);
  });
});
