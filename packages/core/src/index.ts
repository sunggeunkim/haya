// Config
export { AssistantConfigSchema, GatewayAuthSchema } from "./config/schema.js";
export type {
  AssistantConfig,
  CronJob,
  GatewayAuth,
  GatewayTls,
  LoggingConfig,
  MemoryConfig,
} from "./config/types.js";
export { DEFAULT_CONFIG } from "./config/defaults.js";
export { resolveSecret, requireSecret } from "./config/secrets.js";
export { validateConfig, ConfigValidationError } from "./config/validation.js";
export {
  loadConfig,
  saveConfig,
  generateToken,
  initializeConfig,
} from "./config/loader.js";

// Security
export { safeEqualSecret } from "./security/secret-equal.js";
export { safeExecSync } from "./security/command-exec.js";
export {
  wrapExternalContent,
  getBoundaryMarkers,
} from "./security/external-content.js";
export type { WrappedContent } from "./security/external-content.js";

// Infrastructure
export { createLogger, redactSensitive } from "./infra/logger.js";
export type { LogLevel } from "./infra/logger.js";
export {
  AppError,
  ConfigError,
  AuthError,
  ValidationError,
  NotFoundError,
  RateLimitError,
} from "./infra/errors.js";
