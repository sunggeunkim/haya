/**
 * Discord channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface DiscordConfig {
  /** Env var name for the Discord bot token (default: DISCORD_BOT_TOKEN) */
  botTokenEnvVar: string;
}

const DEFAULT_DISCORD_CONFIG: DiscordConfig = {
  botTokenEnvVar: "DISCORD_BOT_TOKEN",
};

/**
 * Resolve Discord config from channel settings, falling back to defaults.
 */
export function resolveDiscordConfig(
  settings: Record<string, unknown>,
): DiscordConfig {
  return {
    botTokenEnvVar:
      typeof settings.botTokenEnvVar === "string"
        ? settings.botTokenEnvVar
        : DEFAULT_DISCORD_CONFIG.botTokenEnvVar,
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
