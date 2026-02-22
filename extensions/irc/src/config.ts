/**
 * IRC channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface IRCConfig {
  /** IRC server hostname */
  server: string;
  /** IRC server port (default: 6697 for TLS, 6667 for plain) */
  port: number;
  /** Whether to use TLS (default: true) */
  tls: boolean;
  /** Bot nickname */
  nick: string;
  /** Channels to join (e.g., ["#general", "#random"]) */
  channels: string[];
  /** Env var name for the server password (optional) */
  passwordEnvVar?: string;
}

const DEFAULT_IRC_CONFIG: Partial<IRCConfig> = {
  port: 6697,
  tls: true,
  nick: "haya-bot",
  channels: [],
};

/**
 * Resolve IRC config from channel settings, falling back to defaults.
 */
export function resolveIRCConfig(
  settings: Record<string, unknown>,
): IRCConfig {
  const tls =
    typeof settings.tls === "boolean"
      ? settings.tls
      : DEFAULT_IRC_CONFIG.tls!;

  return {
    server:
      typeof settings.server === "string"
        ? settings.server
        : "localhost",
    port:
      typeof settings.port === "number"
        ? settings.port
        : tls
          ? 6697
          : 6667,
    tls,
    nick:
      typeof settings.nick === "string"
        ? settings.nick
        : DEFAULT_IRC_CONFIG.nick!,
    channels: Array.isArray(settings.channels)
      ? (settings.channels as string[])
      : DEFAULT_IRC_CONFIG.channels!,
    passwordEnvVar:
      typeof settings.passwordEnvVar === "string"
        ? settings.passwordEnvVar
        : undefined,
  };
}

/**
 * Resolve an optional environment variable.
 */
export function resolveEnv(envVarName: string): string | undefined {
  return process.env[envVarName] || undefined;
}
