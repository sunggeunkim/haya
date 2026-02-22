/**
 * Signal channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface SignalConfig {
  /** URL for the signal-cli JSON-RPC daemon (default: http://localhost:7583) */
  jsonRpcUrl: string;
  /** Env var name for the registered phone number (default: SIGNAL_PHONE_NUMBER) */
  registeredNumberEnvVar: string;
}

const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  jsonRpcUrl: "http://localhost:7583",
  registeredNumberEnvVar: "SIGNAL_PHONE_NUMBER",
};

/**
 * Resolve Signal config from channel settings, falling back to defaults.
 */
export function resolveSignalConfig(
  settings: Record<string, unknown>,
): SignalConfig {
  return {
    jsonRpcUrl:
      typeof settings.jsonRpcUrl === "string"
        ? settings.jsonRpcUrl
        : DEFAULT_SIGNAL_CONFIG.jsonRpcUrl,
    registeredNumberEnvVar:
      typeof settings.registeredNumberEnvVar === "string"
        ? settings.registeredNumberEnvVar
        : DEFAULT_SIGNAL_CONFIG.registeredNumberEnvVar,
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
