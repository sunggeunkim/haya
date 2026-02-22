/**
 * LINE channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface LineConfig {
  /** Env var name for the LINE channel access token (default: LINE_CHANNEL_ACCESS_TOKEN) */
  channelAccessTokenEnvVar: string;
  /** Env var name for the LINE channel secret (default: LINE_CHANNEL_SECRET) */
  channelSecretEnvVar: string;
}

const DEFAULT_LINE_CONFIG: LineConfig = {
  channelAccessTokenEnvVar: "LINE_CHANNEL_ACCESS_TOKEN",
  channelSecretEnvVar: "LINE_CHANNEL_SECRET",
};

/**
 * Resolve LINE config from channel settings, falling back to defaults.
 */
export function resolveLineConfig(
  settings: Record<string, unknown>,
): LineConfig {
  return {
    channelAccessTokenEnvVar:
      typeof settings.channelAccessTokenEnvVar === "string"
        ? settings.channelAccessTokenEnvVar
        : DEFAULT_LINE_CONFIG.channelAccessTokenEnvVar,
    channelSecretEnvVar:
      typeof settings.channelSecretEnvVar === "string"
        ? settings.channelSecretEnvVar
        : DEFAULT_LINE_CONFIG.channelSecretEnvVar,
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
