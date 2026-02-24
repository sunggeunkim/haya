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

export const GoogleConfigSchema = z.object({
  clientIdEnvVar: z.string(),
  clientSecretEnvVar: z.string(),
  refreshTokenEnvVar: z.string().optional(),
  tokenPath: z.string().default("data/google-tokens.json"),
  calendar: z
    .object({ enabled: z.boolean().default(false) })
    .default({ enabled: false }),
  gmail: z
    .object({ enabled: z.boolean().default(false) })
    .default({ enabled: false }),
  drive: z
    .object({ enabled: z.boolean().default(false) })
    .default({ enabled: false }),
});

export const WebSearchProviderSchema = z.object({
  provider: z.enum(["brave", "google", "tavily"]),
  apiKeyEnvVar: z.string(),
  searchEngineId: z.string().optional(),
});

export const WebSearchConfigSchema = z.array(WebSearchProviderSchema).min(1);

export const ImageGenerationConfigSchema = z.object({
  provider: z.enum(["openai"]).default("openai"),
  apiKeyEnvVar: z.string(),
});

export const AutoReplyRuleConfigSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  flags: z.string().default("i"),
  reply: z.string(),
  passthrough: z.boolean().default(true),
  enabled: z.boolean().default(true),
  channels: z.array(z.string()).optional(),
});

export const AutoReplyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  rules: z.array(AutoReplyRuleConfigSchema).default([]),
});

export const TwitterSearchConfigSchema = z.object({
  apiKeyEnvVar: z.string(),
});

export const FinanceProviderSchema = z.object({
  provider: z.enum(["yahoo", "alphavantage", "twelvedata", "yfinance"]),
  apiKeyEnvVar: z.string().optional(),
});

export const FinanceConfigSchema = z.array(FinanceProviderSchema).min(1);

export const TodoistConfigSchema = z.object({
  apiKeyEnvVar: z.string(),
});

export const ToolsConfigSchema = z.object({
  googleMapsApiKeyEnvVar: z.string().optional(),
  google: GoogleConfigSchema.optional(),
  webSearch: WebSearchConfigSchema.optional(),
  twitterSearch: TwitterSearchConfigSchema.optional(),
  imageGeneration: ImageGenerationConfigSchema.optional(),
  stockQuote: FinanceConfigSchema.optional(),
  todoist: TodoistConfigSchema.optional(),
});

export const ProviderEntrySchema = z.object({
  name: z.string(),
  apiKeyEnvVar: z.string(),
  baseUrl: z.string().optional(),
  models: z.array(z.string()).optional(),
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

export const BudgetSchema = z.object({
  maxTokensPerSession: z.number().int().min(0).optional(),
  maxTokensPerDay: z.number().int().min(0).optional(),
  maxRequestsPerDay: z.number().int().min(0).optional(),
});

export const ObservabilitySchema = z.object({
  enabled: z.boolean().default(false),
  otlp: z.object({
    endpoint: z.string(),
    headersEnvVar: z.string().optional(),
  }).optional(),
  serviceName: z.string().default("haya"),
});

export const AssistantConfigSchema = z.object({
  configVersion: z.number().int().min(0).optional(),
  gateway: z.object({
    port: z.number().int().min(1).max(65535).default(18789),
    bind: z.enum(["loopback", "lan", "custom"]).default("loopback"),
    auth: GatewayAuthSchema,
    tls: GatewayTlsSchema.optional(),
    trustedProxies: z.array(z.string()).default([]),
  }),
  agent: z.object({
    defaultProvider: z.string().default("openai"),
    defaultModel: z.string().default("gpt-4o"),
    defaultProviderApiKeyEnvVar: z.string().optional(),
    awsRegion: z.string().optional(),
    systemPrompt: z
      .string()
      .default(
        "You are a friendly personal assistant. Keep replies short — 1-3 sentences. Use a warm, casual tone. When something is ambiguous, make your best guess and go with it rather than asking clarifying questions. If a topic is complex, break it into a back-and-forth dialogue rather than a single long answer.",
      ),
    systemPromptFiles: z.array(z.string()).optional(),
    maxHistoryMessages: z.number().int().min(0).default(100),
    workspace: z.string().optional(),
    providers: z.array(ProviderEntrySchema).optional(),
    toolPolicies: z.array(ToolPolicySchema).default([]),
    maxContextTokens: z.number().int().min(1000).optional(),
  }),
  senderAuth: SenderAuthSchema.optional(),
  sessions: z.object({
    pruning: SessionPruningSchema.optional(),
    budgets: BudgetSchema.optional(),
  }).optional(),
  memory: MemorySchema.optional(),
  cron: z.array(CronJobSchema).default([]),
  plugins: z.array(z.string()).default([]),
  logging: LoggingSchema.optional(),
  tools: ToolsConfigSchema.optional(),
  autoReply: AutoReplyConfigSchema.optional(),
  observability: ObservabilitySchema.optional(),
});
