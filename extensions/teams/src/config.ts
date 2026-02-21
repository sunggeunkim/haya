/**
 * Microsoft Teams channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface TeamsConfig {
  /** Env var name for the Teams app (bot) ID (default: TEAMS_APP_ID) */
  appIdEnvVar: string;
  /** Env var name for the Teams app password (default: TEAMS_APP_PASSWORD) */
  appPasswordEnvVar: string;
  /** Env var name for the Azure tenant ID (default: TEAMS_TENANT_ID) */
  tenantIdEnvVar: string;
}

const DEFAULT_TEAMS_CONFIG: TeamsConfig = {
  appIdEnvVar: "TEAMS_APP_ID",
  appPasswordEnvVar: "TEAMS_APP_PASSWORD",
  tenantIdEnvVar: "TEAMS_TENANT_ID",
};

/**
 * Resolve Teams config from channel settings, falling back to defaults.
 */
export function resolveTeamsConfig(
  settings: Record<string, unknown>,
): TeamsConfig {
  return {
    appIdEnvVar:
      typeof settings.appIdEnvVar === "string"
        ? settings.appIdEnvVar
        : DEFAULT_TEAMS_CONFIG.appIdEnvVar,
    appPasswordEnvVar:
      typeof settings.appPasswordEnvVar === "string"
        ? settings.appPasswordEnvVar
        : DEFAULT_TEAMS_CONFIG.appPasswordEnvVar,
    tenantIdEnvVar:
      typeof settings.tenantIdEnvVar === "string"
        ? settings.tenantIdEnvVar
        : DEFAULT_TEAMS_CONFIG.tenantIdEnvVar,
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
