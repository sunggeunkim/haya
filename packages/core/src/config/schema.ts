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
    systemPrompt: z.string().optional(),
    maxHistoryMessages: z.number().int().min(0).default(100),
  }),
  memory: MemorySchema.optional(),
  cron: z.array(CronJobSchema).default([]),
  plugins: z.array(z.string()).default([]),
  logging: LoggingSchema.optional(),
});
