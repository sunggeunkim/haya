import type { z } from "zod";
import type {
  AssistantConfigSchema,
  CronJobSchema,
  GatewayAuthSchema,
  GatewayTlsSchema,
  LoggingSchema,
  MemorySchema,
} from "./schema.js";

export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;
export type GatewayAuth = z.infer<typeof GatewayAuthSchema>;
export type GatewayTls = z.infer<typeof GatewayTlsSchema>;
export type MemoryConfig = z.infer<typeof MemorySchema>;
export type CronJob = z.infer<typeof CronJobSchema>;
export type LoggingConfig = z.infer<typeof LoggingSchema>;
