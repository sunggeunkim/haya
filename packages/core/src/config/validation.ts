import type { AssistantConfig } from "./types.js";

export class ConfigValidationError extends Error {
  constructor(
    public readonly errors: string[],
  ) {
    super(`Config validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

/**
 * Cross-field validation that goes beyond what Zod schema refinements handle.
 * These are rules that span multiple top-level fields.
 */
export function validateConfig(config: AssistantConfig): void {
  const errors: string[] = [];

  // TLS required for non-loopback binds
  if (config.gateway.bind !== "loopback") {
    const tlsEnabled = config.gateway.tls?.enabled === true;
    if (!tlsEnabled) {
      errors.push(
        `TLS must be enabled when binding to "${config.gateway.bind}". ` +
          "Set gateway.tls.enabled = true or use bind = \"loopback\".",
      );
    }
  }

  // If TLS is enabled, cert and key paths must be provided
  if (config.gateway.tls?.enabled) {
    if (!config.gateway.tls.certPath) {
      errors.push("gateway.tls.certPath is required when TLS is enabled.");
    }
    if (!config.gateway.tls.keyPath) {
      errors.push("gateway.tls.keyPath is required when TLS is enabled.");
    }
  }

  // trustedProxies should be valid IP-like strings
  for (const proxy of config.gateway.trustedProxies) {
    if (!isValidProxyAddress(proxy)) {
      errors.push(
        `Invalid trustedProxy address: "${proxy}". Must be an IP address or CIDR.`,
      );
    }
  }

  // Cron job validation
  for (const cronJob of config.cron) {
    if (cronJob.action === "agent_prompt") {
      if (!cronJob.metadata?.prompt || typeof cronJob.metadata.prompt !== "string") {
        errors.push(`cron job "${cronJob.name}": agent_prompt requires metadata.prompt`);
      }
    }
  }

  // Provider-specific validation
  const provider = (config.agent as Record<string, unknown>).defaultProvider as string | undefined ?? "openai";

  if (provider === "bedrock") {
    const awsRegion = (config.agent as Record<string, unknown>).awsRegion as string | undefined;
    if (!awsRegion && !process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
      errors.push(
        'Bedrock provider requires an AWS region. Set agent.awsRegion in config or the AWS_REGION / AWS_DEFAULT_REGION environment variable.',
      );
    }
  } else {
    if (!config.agent.defaultProviderApiKeyEnvVar) {
      errors.push(
        `Provider "${provider}" requires agent.defaultProviderApiKeyEnvVar to be set.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }
}

const IP_OR_CIDR_RE =
  /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^([0-9a-fA-F:]+)(\/\d{1,3})?$/;

function isValidProxyAddress(address: string): boolean {
  return IP_OR_CIDR_RE.test(address);
}
