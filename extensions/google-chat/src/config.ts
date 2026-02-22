/**
 * Google Chat channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface GoogleChatConfig {
  /** Port for the webhook HTTP server (default: 8443) */
  webhookPort: number;
  /** Env var name for the Bearer verification token (default: GOOGLE_CHAT_VERIFY_TOKEN) */
  verifyTokenEnvVar: string;
}

const DEFAULT_GOOGLE_CHAT_CONFIG: GoogleChatConfig = {
  webhookPort: 8443,
  verifyTokenEnvVar: "GOOGLE_CHAT_VERIFY_TOKEN",
};

/**
 * Resolve Google Chat config from channel settings, falling back to defaults.
 */
export function resolveGoogleChatConfig(
  settings: Record<string, unknown>,
): GoogleChatConfig {
  return {
    webhookPort:
      typeof settings.webhookPort === "number"
        ? settings.webhookPort
        : DEFAULT_GOOGLE_CHAT_CONFIG.webhookPort,
    verifyTokenEnvVar:
      typeof settings.verifyTokenEnvVar === "string"
        ? settings.verifyTokenEnvVar
        : DEFAULT_GOOGLE_CHAT_CONFIG.verifyTokenEnvVar,
  };
}

/**
 * Resolve a required environment variable.
 */
export function requireEnv(envVarName: string): string {
  const value = process.env[envVarName];
  if (!value) {
    throw new Error(
      `Required environment variable not set: ${envVarName}`,
    );
  }
  return value;
}
