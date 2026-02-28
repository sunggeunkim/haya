import type { AssistantConfig } from "./types.js";

/**
 * Provides sensible defaults for optional fields. Auth credentials
 * are intentionally NOT defaulted — they must be explicitly provided.
 */
export const DEFAULT_CONFIG: Omit<AssistantConfig, "gateway" | "agent"> & {
  gateway: Omit<AssistantConfig["gateway"], "auth"> & {
    auth?: undefined;
  };
  agent: Omit<AssistantConfig["agent"], "defaultProviderApiKeyEnvVar"> & {
    defaultProviderApiKeyEnvVar?: undefined;
  };
} = {
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: undefined,
    trustedProxies: [],
  },
  agent: {
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
    defaultProviderApiKeyEnvVar: undefined,
    systemPrompt:
      "You are a friendly personal assistant. Keep replies short — 1-3 sentences. Use a warm, casual tone. When something is ambiguous, make your best guess and go with it rather than asking clarifying questions. If a topic is complex, break it into a back-and-forth dialogue rather than a single long answer.",
    maxHistoryMessages: 100,
    maxContextTokens: 128_000,
    toolPolicies: [],
    specialists: [],
  },
  cron: [],
  plugins: [],
  logging: {
    level: "info",
    redactSecrets: true,
    dir: "data/logs",
    maxSizeMB: 10,
    maxFiles: 5,
  },
};
