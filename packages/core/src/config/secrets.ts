/**
 * Resolves secrets from environment variables only.
 * Config files store env var NAMES (references), never actual secret values.
 */

const ENV_VAR_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

export function resolveSecret(envVarName: string): string | undefined {
  if (!ENV_VAR_NAME_RE.test(envVarName)) {
    throw new Error(
      `Invalid env var name: "${envVarName}". ` +
        "Must be uppercase alphanumeric with underscores.",
    );
  }
  return process.env[envVarName];
}

export function requireSecret(envVarName: string): string {
  const value = resolveSecret(envVarName);
  if (value === undefined || value === "") {
    throw new Error(
      `Required environment variable "${envVarName}" is not set or empty.`,
    );
  }
  return value;
}
