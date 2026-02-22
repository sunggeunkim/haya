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
    defaultModel: "gpt-4o",
    defaultProviderApiKeyEnvVar: undefined,
    systemPrompt:
      "You are a helpful assistant responding to users in a chat conversation. Reply directly and concisely.",
    maxHistoryMessages: 100,
    toolPolicies: [],
  },
  cron: [],
  plugins: [],
  logging: {
    level: "info",
    redactSecrets: true,
  },
};
