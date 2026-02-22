import { z } from "zod";

export const GatewayAuthSchema = z
  .object({
    mode: z.enum(["token", "password"]),
    token: z.string().min(32).optional(),
    password: z.string().min(16).optional(),
  })
  .refine(
    (auth) => {
      if (auth.mode === "token")
        return typeof auth.token === "string" && auth.token.length >= 32;
      if (auth.mode === "password")
        return typeof auth.password === "string" && auth.password.length >= 16;
      return false;
    },
    { message: "Auth credential required for selected mode" },
  );

export const GatewayTlsSchema = z.object({
  enabled: z.boolean().default(false),
  certPath: z.string().optional(),
  keyPath: z.string().optional(),
});

export const MemorySchema = z.object({
  enabled: z.boolean().default(false),
  dbPath: z.string().optional(),
  embeddingProviderApiKeyEnvVar: z.string().optional(),
});

export const CronJobSchema = z.object({
  name: z.string(),
  schedule: z.string(),
  action: z.string(),
  enabled: z.boolean().default(true),
});

export const LoggingSchema = z.object({
  level: z
    .enum(["silly", "trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  redactSecrets: z.boolean().default(true),
});

export const ToolsConfigSchema = z.object({
  googleMapsApiKeyEnvVar: z.string().optional(),
});

export const ToolPolicySchema = z.object({
  toolName: z.string(),
  level: z.enum(["allow", "confirm", "deny"]),
});

export const SenderAuthSchema = z.object({
  mode: z.enum(["open", "pairing", "allowlist"]).default("open"),
  dataDir: z.string().default("data/senders"),
});

export const SessionPruningSchema = z.object({
  enabled: z.boolean().default(false),
  maxAgeDays: z.number().int().min(1).default(90),
  maxSizeMB: z.number().min(1).default(500),
});

export const AssistantConfigSchema = z.object({
  gateway: z.object({
    port: z.number().int().min(1).max(65535).default(18789),
    bind: z.enum(["loopback", "lan", "custom"]).default("loopback"),
    auth: GatewayAuthSchema,
    tls: GatewayTlsSchema.optional(),
    trustedProxies: z.array(z.string()).default([]),
  }),
  agent: z.object({
    defaultModel: z.string().default("gpt-4o"),
    defaultProviderApiKeyEnvVar: z.string(),
    systemPrompt: z
      .string()
      .default(
        "You are a helpful assistant responding to users in a chat conversation. Reply directly and concisely.",
      ),
    maxHistoryMessages: z.number().int().min(0).default(100),
    workspace: z.string().optional(),
    toolPolicies: z.array(ToolPolicySchema).default([]),
  }),
  senderAuth: SenderAuthSchema.optional(),
  sessions: z.object({
    pruning: SessionPruningSchema.optional(),
  }).optional(),
  memory: MemorySchema.optional(),
  cron: z.array(CronJobSchema).default([]),
  plugins: z.array(z.string()).default([]),
  logging: LoggingSchema.optional(),
  tools: ToolsConfigSchema.optional(),
});
