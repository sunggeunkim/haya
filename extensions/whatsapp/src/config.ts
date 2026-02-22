/**
 * WhatsApp Cloud API channel configuration.
 * All sensitive values are resolved from environment variables at runtime.
 */
export interface WhatsAppConfig {
  /** WhatsApp Cloud API phone number ID */
  phoneNumberId: string;
  /** Env var name for the WhatsApp access token (default: WHATSAPP_ACCESS_TOKEN) */
  accessTokenEnvVar: string;
  /** Webhook verification token */
  verifyToken: string;
  /** Webhook path (default: /webhook/whatsapp) */
  webhookPath: string;
  /** Port for the webhook HTTP server (default: 3100) */
  port: number;
}

const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  phoneNumberId: "",
  accessTokenEnvVar: "WHATSAPP_ACCESS_TOKEN",
  verifyToken: "",
  webhookPath: "/webhook/whatsapp",
  port: 3100,
};

/**
 * Resolve WhatsApp config from channel settings, falling back to defaults.
 */
export function resolveWhatsAppConfig(
  settings: Record<string, unknown>,
): WhatsAppConfig {
  return {
    phoneNumberId:
      typeof settings.phoneNumberId === "string"
        ? settings.phoneNumberId
        : DEFAULT_WHATSAPP_CONFIG.phoneNumberId,
    accessTokenEnvVar:
      typeof settings.accessTokenEnvVar === "string"
        ? settings.accessTokenEnvVar
        : DEFAULT_WHATSAPP_CONFIG.accessTokenEnvVar,
    verifyToken:
      typeof settings.verifyToken === "string"
        ? settings.verifyToken
        : DEFAULT_WHATSAPP_CONFIG.verifyToken,
    webhookPath:
      typeof settings.webhookPath === "string"
        ? settings.webhookPath
        : DEFAULT_WHATSAPP_CONFIG.webhookPath,
    port:
      typeof settings.port === "number"
        ? settings.port
        : DEFAULT_WHATSAPP_CONFIG.port,
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
