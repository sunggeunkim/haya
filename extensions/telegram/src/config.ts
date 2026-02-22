/**
 * Telegram channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface TelegramConfig {
  /** Env var name for the Telegram bot token (default: TELEGRAM_BOT_TOKEN) */
  botTokenEnvVar: string;
}

const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
};

/**
 * Resolve Telegram config from channel settings, falling back to defaults.
 */
export function resolveTelegramConfig(
  settings: Record<string, unknown>,
): TelegramConfig {
  return {
    botTokenEnvVar:
      typeof settings.botTokenEnvVar === "string"
        ? settings.botTokenEnvVar
        : DEFAULT_TELEGRAM_CONFIG.botTokenEnvVar,
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
