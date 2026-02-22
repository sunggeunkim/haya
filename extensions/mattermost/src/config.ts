/**
 * Mattermost channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface MattermostConfig {
  /** Env var name for the Mattermost server URL (default: MATTERMOST_SERVER_URL) */
  serverUrlEnvVar: string;
  /** Env var name for the Mattermost access token (default: MATTERMOST_ACCESS_TOKEN) */
  accessTokenEnvVar: string;
  /** Env var name for the Mattermost bot username (default: MATTERMOST_BOT_USERNAME) — optional */
  botUsernameEnvVar: string;
}

const DEFAULT_MATTERMOST_CONFIG: MattermostConfig = {
  serverUrlEnvVar: "MATTERMOST_SERVER_URL",
  accessTokenEnvVar: "MATTERMOST_ACCESS_TOKEN",
  botUsernameEnvVar: "MATTERMOST_BOT_USERNAME",
};

/**
 * Resolve Mattermost config from channel settings, falling back to defaults.
 */
export function resolveMattermostConfig(
  settings: Record<string, unknown>,
): MattermostConfig {
  return {
    serverUrlEnvVar:
      typeof settings.serverUrlEnvVar === "string"
        ? settings.serverUrlEnvVar
        : DEFAULT_MATTERMOST_CONFIG.serverUrlEnvVar,
    accessTokenEnvVar:
      typeof settings.accessTokenEnvVar === "string"
        ? settings.accessTokenEnvVar
        : DEFAULT_MATTERMOST_CONFIG.accessTokenEnvVar,
    botUsernameEnvVar:
      typeof settings.botUsernameEnvVar === "string"
        ? settings.botUsernameEnvVar
        : DEFAULT_MATTERMOST_CONFIG.botUsernameEnvVar,
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

/**
 * Resolve an optional environment variable (returns undefined if not set).
 */
export function optionalEnv(envVarName: string): string | undefined {
  const value = process.env[envVarName];
  return value || undefined;
}
