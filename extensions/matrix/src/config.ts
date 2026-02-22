/**
 * Matrix channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface MatrixConfig {
  /** Env var name for the Matrix homeserver URL (default: MATRIX_HOMESERVER_URL) */
  homeserverUrlEnvVar: string;
  /** Env var name for the Matrix access token (default: MATRIX_ACCESS_TOKEN) */
  accessTokenEnvVar: string;
  /** Env var name for the Matrix user ID (default: MATRIX_USER_ID) */
  userIdEnvVar: string;
}

const DEFAULT_MATRIX_CONFIG: MatrixConfig = {
  homeserverUrlEnvVar: "MATRIX_HOMESERVER_URL",
  accessTokenEnvVar: "MATRIX_ACCESS_TOKEN",
  userIdEnvVar: "MATRIX_USER_ID",
};

/**
 * Resolve Matrix config from channel settings, falling back to defaults.
 */
export function resolveMatrixConfig(
  settings: Record<string, unknown>,
): MatrixConfig {
  return {
    homeserverUrlEnvVar:
      typeof settings.homeserverUrlEnvVar === "string"
        ? settings.homeserverUrlEnvVar
        : DEFAULT_MATRIX_CONFIG.homeserverUrlEnvVar,
    accessTokenEnvVar:
      typeof settings.accessTokenEnvVar === "string"
        ? settings.accessTokenEnvVar
        : DEFAULT_MATRIX_CONFIG.accessTokenEnvVar,
    userIdEnvVar:
      typeof settings.userIdEnvVar === "string"
        ? settings.userIdEnvVar
        : DEFAULT_MATRIX_CONFIG.userIdEnvVar,
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
