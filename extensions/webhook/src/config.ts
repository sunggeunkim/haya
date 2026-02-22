/**
 * Webhook channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface WebhookSource {
  /** Human-readable name for this webhook source */
  name: string;
  /** Env var name holding the HMAC secret for signature validation */
  secretEnvVar: string;
}

export interface WebhookConfig {
  /** Port to listen on (default: 9090) */
  port: number;
  /** Path to listen on (default: "/webhook") */
  path: string;
  /** Maximum payload size in bytes (default: 1048576 = 1 MB) */
  maxPayloadBytes: number;
  /** Configured webhook sources for HMAC validation */
  sources: WebhookSource[];
}

const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  port: 9090,
  path: "/webhook",
  maxPayloadBytes: 1_048_576,
  sources: [],
};

/**
 * Resolve Webhook config from channel settings, falling back to defaults.
 */
export function resolveWebhookConfig(
  settings: Record<string, unknown>,
): WebhookConfig {
  return {
    port:
      typeof settings.port === "number"
        ? settings.port
        : DEFAULT_WEBHOOK_CONFIG.port,
    path:
      typeof settings.path === "string"
        ? settings.path
        : DEFAULT_WEBHOOK_CONFIG.path,
    maxPayloadBytes:
      typeof settings.maxPayloadBytes === "number"
        ? settings.maxPayloadBytes
        : DEFAULT_WEBHOOK_CONFIG.maxPayloadBytes,
    sources:
      Array.isArray(settings.sources)
        ? (settings.sources as WebhookSource[])
        : DEFAULT_WEBHOOK_CONFIG.sources,
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
