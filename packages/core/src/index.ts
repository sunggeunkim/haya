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

// Gateway
export { createGateway } from "./gateway/server.js";
export type { GatewayInstance, GatewayOptions } from "./gateway/server.js";
export { createGatewayHttpServer } from "./gateway/server-http.js";
export { createGatewayWsServer } from "./gateway/server-ws.js";
export type {
  GatewayWsServer,
  MethodHandler,
  WsServerOptions,
} from "./gateway/server-ws.js";
export {
  isLoopbackAddress,
  resolveClientIp,
  resolveBindHost,
  isTrustedProxy,
  ipMatchesCIDR,
} from "./gateway/net.js";
export {
  authorizeRequest,
  extractBearerToken,
  extractCredentials,
} from "./gateway/auth.js";
export type { AuthConfig, AuthMode, AuthResult } from "./gateway/auth.js";
export {
  createAuthRateLimiter,
} from "./gateway/auth-rate-limit.js";
export type {
  AuthRateLimiter,
  RateLimitCheckResult,
  RateLimitConfig,
} from "./gateway/auth-rate-limit.js";
export { generateCspNonce, buildCspHeader } from "./gateway/csp.js";
export {
  generateSelfSignedCert,
  isCertValid,
  ensureTlsCerts,
  buildTlsOptions,
} from "./gateway/tls.js";
export type { TlsCertPaths } from "./gateway/tls.js";
export { parseRequest, buildResponse, buildErrorResponse, buildEvent, serializeFrame } from "./gateway/protocol/frames.js";
export { GatewayRequestSchema, GatewayResponseSchema, GatewayEventSchema, GatewayFrameSchema } from "./gateway/protocol/schema.js";
export { ErrorCodes } from "./gateway/protocol/types.js";
export type { GatewayRequest, GatewayResponse, GatewayError, GatewayEvent } from "./gateway/protocol/types.js";

// Agent
export { AgentRuntime } from "./agent/runtime.js";
export type { AgentRuntimeConfig } from "./agent/runtime.js";
export { createProvider } from "./agent/providers.js";
export type { AIProvider } from "./agent/providers.js";
export { ToolRegistry } from "./agent/tools.js";
export type {
  AgentTool,
  ChatRequest,
  ChatResponse,
  ChatChunkEvent,
  CompletionRequest,
  CompletionResponse,
  Message,
  MessageRole,
  ProviderConfig,
  StreamCallback,
  TokenUsage,
  ToolCall,
  ToolResult,
} from "./agent/types.js";

// Sessions
export { SessionStore } from "./sessions/store.js";
export { HistoryManager } from "./sessions/history.js";
export type {
  Session,
  SessionEntry,
  SessionListItem,
  SessionMeta,
} from "./sessions/types.js";

// Gateway server methods
export { createChatSendHandler } from "./gateway/server-methods/chat.js";
export {
  createSessionsListHandler,
  createSessionsCreateHandler,
  createSessionsDeleteHandler,
  createSessionsHistoryHandler,
} from "./gateway/server-methods/sessions.js";

// Memory
export { createMemoryManager } from "./memory/manager.js";
export type { MemoryManagerConfig } from "./memory/manager.js";
export { createMemoryDatabase } from "./memory/sqlite.js";
export type { MemoryDatabase } from "./memory/sqlite.js";
export {
  loadSqliteVec,
  createVectorIndex,
  distanceToScore,
  normalizeEmbedding,
} from "./memory/sqlite-vec.js";
export type { VectorIndex } from "./memory/sqlite-vec.js";
export { createEmbeddingProvider } from "./memory/embeddings.js";
export type { EmbeddingProviderConfig } from "./memory/embeddings.js";
export { hybridSearch, bm25RankToScore } from "./memory/hybrid.js";
export type {
  MemoryEntry,
  MemorySearchResult,
  MemorySearchManager,
  EmbeddingProvider,
  HybridSearchOptions,
} from "./memory/types.js";
export { DEFAULT_HYBRID_OPTIONS } from "./memory/types.js";

// Plugins
export { PluginRegistry } from "./plugins/registry.js";
export { HookRegistry } from "./plugins/hooks.js";
export { loadPluginModule, loadPlugins } from "./plugins/loader.js";
export type {
  PluginDefinition,
  PluginApi,
  PluginPermissions,
  PluginLogger,
  HookHandler,
  LoadedPlugin,
  PluginStatus,
  HostToWorkerMessage,
  WorkerToHostMessage,
  WorkerPluginManifest,
  WorkerToolDefinition,
} from "./plugins/types.js";

// Security — Audit
export {
  runSecurityAudit,
  formatAuditResults,
} from "./security/audit.js";
export type { AuditResult, SecurityAuditReport } from "./security/audit.js";

// Security — Plugin sandbox
export {
  createSandboxedWorker,
  buildPermissionFlags,
  validatePluginPermissions,
} from "./security/plugin-sandbox.js";
export type { SandboxedWorker, SandboxOptions } from "./security/plugin-sandbox.js";

// Channels
export { ChannelRegistry } from "./channels/registry.js";
export { ChannelDock } from "./channels/dock.js";
export type { ChannelDockStatus } from "./channels/dock.js";
export type {
  ChannelPlugin,
  ChannelStatus,
  ChannelCapabilities,
  ChannelConfig,
  ChannelRuntime,
  InboundMessage,
  OutboundMessage,
  ChannelMessageHandler,
} from "./channels/types.js";

// Cron
export { CronStore } from "./cron/store.js";
export type { CronJobEntry } from "./cron/store.js";
export { CronService } from "./cron/service.js";
export type { CronActionHandler } from "./cron/service.js";

// Gateway server methods — channels & cron
export {
  createChannelsListHandler,
  createChannelsStartHandler,
  createChannelsStopHandler,
} from "./gateway/server-methods/channels.js";
export {
  createCronListHandler,
  createCronStatusHandler,
  createCronAddHandler,
  createCronRemoveHandler,
} from "./gateway/server-methods/cron.js";
