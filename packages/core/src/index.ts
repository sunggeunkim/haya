// Config
export {
  AssistantConfigSchema,
  GatewayAuthSchema,
  ToolPolicySchema,
  SenderAuthSchema,
  SessionPruningSchema,
  GoogleConfigSchema,
  ObservabilitySchema,
  ImageGenerationConfigSchema,
  AutoReplyConfigSchema,
  AutoReplyRuleConfigSchema,
  FinanceProviderSchema,
  FinanceConfigSchema,
  FlightProviderSchema,
  FlightConfigSchema,
  TodoistConfigSchema,
  ContextPruningSchema,
  CompactionSchema,
} from "./config/schema.js";
export type {
  AssistantConfig,
  CronJob,
  GatewayAuth,
  GatewayTls,
  LoggingConfig,
  MemoryConfig,
  ObservabilityConfig,
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
export { WorkspaceGuard, WorkspaceViolationError } from "./security/workspace.js";
export { SenderAuthManager } from "./security/sender-auth.js";
export type {
  SenderAuthMode,
  SenderStatus,
  PairingCode,
} from "./security/sender-auth.js";

// Infrastructure
export { ActivityLogger, noopActivityLogger } from "./infra/activity-logger.js";
export type { IActivityLogger, ActivityLoggerConfig, ToolLogRecord, ProviderLogRecord, ActivityLogRecord } from "./infra/activity-logger.js";
export { createLogger, redactSensitive } from "./infra/logger.js";
export type { LogLevel } from "./infra/logger.js";
export { markdownToMrkdwn } from "./infra/markdown-to-mrkdwn.js";
export {
  AppError,
  ConfigError,
  AuthError,
  ValidationError,
  NotFoundError,
  RateLimitError,
} from "./infra/errors.js";
export {
  initTelemetry,
  getTracer,
  getMeter,
  shutdownTelemetry,
} from "./infra/telemetry.js";
export type { TelemetryConfig } from "./infra/telemetry.js";

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
export { createBedrockProvider } from "./agent/bedrock.js";
export { ToolRegistry } from "./agent/tools.js";
export { ToolPolicyEngine } from "./agent/tool-policy.js";
export type {
  PolicyLevel,
  ToolPolicy,
  ApprovalCallback,
} from "./agent/tool-policy.js";
export {
  builtinTools,
  createSessionTools,
  defaultToolPolicies,
  webFetchTool,
  shellExecTool,
  fileReadTool,
  fileWriteTool,
  fileListTool,
  browserActionTool,
} from "./agent/builtin-tools.js";
export type { BuiltinTool } from "./agent/builtin-tools.js";
export type {
  AgentTool,
  ChatRequest,
  ChatResponse,
  ChatChunkEvent,
  CompletionRequest,
  CompletionResponse,
  ContentPart,
  Message,
  MessageRole,
  ProviderConfig,
  StreamCallback,
  TokenUsage,
  ToolCall,
  ToolResult,
} from "./agent/types.js";
export { createCalendarTools } from "./agent/google-calendar-tools.js";
export { createGmailTools } from "./agent/google-gmail-tools.js";
export { createDriveTools } from "./agent/google-drive-tools.js";
export { createMemoryTools } from "./agent/memory-tools.js";
export { createReminderTools } from "./agent/reminder-tools.js";
export { createSearchTools, createTwitterSearchTools } from "./agent/search-tools.js";
export type { TwitterSearchConfig } from "./agent/search-tools.js";
export { createFinanceTools } from "./agent/finance-tools.js";
export type { FinanceProvider } from "./agent/finance-tools.js";
export { createFlightTools } from "./agent/flight-tools.js";
export type { FlightProvider } from "./agent/flight-tools.js";
export { createImageTools } from "./agent/image-tools.js";
export { createMessageTools } from "./agent/message-tools.js";
export { createGatewayTools } from "./agent/gateway-tools.js";
export type { GatewayToolContext } from "./agent/gateway-tools.js";
export { createVisionTools } from "./agent/vision-tools.js";
export { createAutoReplyTools } from "./agent/auto-reply-tools.js";
export { createLinkTools } from "./agent/link-tools.js";
export { createGeminiProvider } from "./agent/gemini.js";
export { createCodeEvalTools } from "./agent/code-eval-tools.js";
export { createDataTools } from "./agent/data-tools.js";
export { createHashTools } from "./agent/hash-tools.js";
export { createWeatherTools } from "./agent/weather-tools.js";
export { createBibleTools } from "./agent/bible-tools.js";
export { createBibleSdkTools } from "./agent/biblesdk-tools.js";
export { createNetBibleTools } from "./agent/netbible-tools.js";
export { createLectionaryTools } from "./agent/lectionary-tools.js";
export { createHymnTools } from "./agent/hymn-tools.js";
export { createBibleTopicTools } from "./agent/bible-topic-tools.js";
export { createCrossRefTools } from "./agent/cross-ref-tools.js";
export { createHelloAoTools } from "./agent/helloao-tools.js";
export { createBibleHubTools } from "./agent/biblehub-tools.js";
export { createHttpTools } from "./agent/http-tools.js";
export { createSystemTools } from "./agent/system-tools.js";
export { createPdfTools } from "./agent/pdf-tools.js";
export { createArchiveTools } from "./agent/archive-tools.js";
export { createAudioTools } from "./agent/audio-tools.js";
export { createQrTools } from "./agent/qr-tools.js";
export { createTodoistTools } from "./agent/todoist-tools.js";
export type { TodoistConfig } from "./agent/todoist-tools.js";
export { createProfileTools } from "./agent/profile-tools.js";
export { compactHistory, compactHistoryWithSummary } from "./agent/compaction.js";
export type { CompactionOptions, CompactionResult } from "./agent/compaction.js";
export { pruneToolResults, DEFAULT_CONTEXT_PRUNING_SETTINGS } from "./agent/context-pruning.js";
export type { ContextPruningSettings } from "./agent/context-pruning.js";
export {
  resolveContextWindow,
  evaluateContextWindowGuard,
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
} from "./agent/context-window-guard.js";
export type {
  ContextWindowInfo,
  ContextWindowGuardResult,
  ContextWindowSource,
} from "./agent/context-window-guard.js";
export { summarizeMessages, chunkMessagesByMaxTokens } from "./agent/summarizer.js";
export type { SummarizerConfig } from "./agent/summarizer.js";
export {
  shouldRunMemoryFlush,
  estimateSessionTokens,
  buildMemoryFlushMessages,
  DEFAULT_MEMORY_FLUSH_PROMPT,
  DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT,
} from "./agent/memory-flush.js";
export type { MemoryFlushSettings, MemoryFlushParams } from "./agent/memory-flush.js";

// Google OAuth
export { GoogleAuth, callGoogleApi, callGoogleApiText } from "./google/auth.js";
export type { GoogleAuthConfig } from "./google/auth.js";

// Sessions
export { SessionStore } from "./sessions/store.js";
export { SenderProfileStore } from "./sessions/profile-store.js";
export { HistoryManager } from "./sessions/history.js";
export { UsageTracker } from "./sessions/usage.js";
export type { UsageRecord } from "./sessions/usage.js";
export type { GetHistoryOptions } from "./sessions/history.js";
export type {
  Session,
  SessionEntry,
  SessionListItem,
  SessionMeta,
  CompactionMeta,
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
  MediaAttachment,
  MessageEmbed,
  MessageButton,
} from "./channels/types.js";
export { MessageRouter } from "./channels/router.js";
export type {
  GroupChatMode,
  MessageRouterConfig,
} from "./channels/router.js";
export { AutoReplyEngine } from "./channels/auto-reply.js";
export { AutoReplyRuleSchema } from "./channels/auto-reply.js";
export type { AutoReplyRule, AutoReplyMatch } from "./channels/auto-reply.js";
export { AutoReplyStore } from "./channels/auto-reply-store.js";

// Media
export { MediaPipeline } from "./media/pipeline.js";
export type {
  MediaAttachment as MediaPipelineAttachment,
  ProcessedMedia,
} from "./media/pipeline.js";

// CLI
export { checkForUpdate, compareVersions, formatUpdateNotice } from "./cli/update.js";
export type { UpdateCheckResult } from "./cli/update.js";
export { runDoctorChecks, formatDoctorResults } from "./cli/doctor.js";
export type { DoctorCheck, DoctorReport } from "./cli/doctor.js";
export { runOnboardWizard } from "./cli/onboard.js";

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
