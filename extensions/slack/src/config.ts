/**
 * Slack channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface SlackConfig {
  /** Env var name for the Slack bot token (default: SLACK_BOT_TOKEN) */
  botTokenEnvVar: string;
  /** Env var name for the Slack app-level token for Socket Mode (default: SLACK_APP_TOKEN) */
  appTokenEnvVar: string;
  /** Env var name for the Slack signing secret (default: SLACK_SIGNING_SECRET) */
  signingSecretEnvVar: string;
}

const DEFAULT_SLACK_CONFIG: SlackConfig = {
  botTokenEnvVar: "SLACK_BOT_TOKEN",
  appTokenEnvVar: "SLACK_APP_TOKEN",
  signingSecretEnvVar: "SLACK_SIGNING_SECRET",
};

/**
 * Resolve Slack config from channel settings, falling back to defaults.
 */
export function resolveSlackConfig(
  settings: Record<string, unknown>,
): SlackConfig {
  return {
    botTokenEnvVar:
      typeof settings.botTokenEnvVar === "string"
        ? settings.botTokenEnvVar
        : DEFAULT_SLACK_CONFIG.botTokenEnvVar,
    appTokenEnvVar:
      typeof settings.appTokenEnvVar === "string"
        ? settings.appTokenEnvVar
        : DEFAULT_SLACK_CONFIG.appTokenEnvVar,
    signingSecretEnvVar:
      typeof settings.signingSecretEnvVar === "string"
        ? settings.signingSecretEnvVar
        : DEFAULT_SLACK_CONFIG.signingSecretEnvVar,
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
