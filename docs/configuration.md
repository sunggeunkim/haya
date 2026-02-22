# Configuration Reference

Haya is configured via a single JSON or JSON5 config file (default: `haya.json`). This document describes every available configuration option.

## File Format

Haya uses [JSON5](https://json5.org/) for configuration, which means you can use:

- **Comments** -- both `//` line comments and `/* block */` comments
- **Trailing commas** -- in objects and arrays
- **Unquoted keys** -- when the key is a valid identifier
- **Single-quoted strings**

Standard JSON files are also valid JSON5, so plain `.json` files work as well.

## File Permissions

Haya enforces `0o600` (owner read/write only) permissions on the config file. When loading a config file, Haya will automatically `chmod` it to `0600` if the permissions are different. When writing config files (e.g., via `haya init`), the `0600` mode is applied at creation time. This protects secret references (tokens, API key env var names) from being read by other users on the system.

## Config Hot-Reload

Haya watches the config file for changes and can apply certain fields without a restart.

**Safe fields** (hot-reloaded without restart):
- `logging`
- `agent.systemPrompt`
- `agent.toolPolicies`
- `agent.maxHistoryMessages`
- `agent.maxContextTokens`
- `cron`

**Unsafe fields** (require a full restart):
- `gateway` (any sub-field)
- `agent.defaultProviderApiKeyEnvVar`
- `agent.providers`

When unsafe fields change, Haya will log a warning indicating that a restart is needed.

---

## gateway

Configuration for the HTTP gateway server.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gateway.port` | `number` (1--65535) | `18789` | TCP port the gateway listens on. |
| `gateway.bind` | `"loopback" \| "lan" \| "custom"` | `"loopback"` | Network binding mode. `"loopback"` binds to 127.0.0.1 only. `"lan"` and `"custom"` bind to broader interfaces but **require TLS to be enabled**. |
| `gateway.auth` | object | *(required)* | Authentication configuration (see below). |
| `gateway.tls` | object | *(optional)* | TLS configuration (see below). |
| `gateway.trustedProxies` | `string[]` | `[]` | List of trusted reverse-proxy IP addresses or CIDR ranges (e.g., `"10.0.0.0/8"`). Used for correct client-IP extraction behind a proxy. |

### gateway.auth

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gateway.auth.mode` | `"token" \| "password"` | *(required)* | Authentication mode. `"token"` uses a bearer token; `"password"` uses a password. |
| `gateway.auth.token` | `string` (min 32 chars) | *(optional)* | The bearer token. Required when `mode` is `"token"`. |
| `gateway.auth.password` | `string` (min 16 chars) | *(optional)* | The password. Required when `mode` is `"password"`. |

### gateway.tls

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gateway.tls.enabled` | `boolean` | `false` | Whether TLS is enabled. Must be `true` when `gateway.bind` is not `"loopback"`. |
| `gateway.tls.certPath` | `string` | *(optional)* | Path to the TLS certificate file. Required when `enabled` is `true`. |
| `gateway.tls.keyPath` | `string` | *(optional)* | Path to the TLS private key file. Required when `enabled` is `true`. |

---

## agent

Configuration for the AI agent and model provider.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent.defaultProvider` | `string` | `"openai"` | Name of the default AI provider (e.g., `"openai"`, `"anthropic"`, `"bedrock"`). |
| `agent.defaultModel` | `string` | `"gpt-4o"` | The default model to use for chat completions. |
| `agent.defaultProviderApiKeyEnvVar` | `string` | *(optional)* | Name of the environment variable containing the API key for the default provider (e.g., `"OPENAI_API_KEY"`). Required for all providers except `"bedrock"`. |
| `agent.awsRegion` | `string` | *(optional)* | AWS region for Amazon Bedrock. Required when `defaultProvider` is `"bedrock"` and neither `AWS_REGION` nor `AWS_DEFAULT_REGION` environment variables are set. Example: `"us-east-1"`. |
| `agent.systemPrompt` | `string` | `"You are a helpful assistant responding to users in a chat conversation. Reply directly and concisely."` | The system prompt sent to the AI model at the beginning of every conversation. |
| `agent.systemPromptFiles` | `string[]` | *(optional)* | Array of file paths whose contents are appended to the system prompt. Useful for loading long or reusable prompt fragments from separate files. |
| `agent.maxHistoryMessages` | `number` (integer, >= 0) | `100` | Maximum number of conversation messages retained in session history. Older messages are dropped when this limit is exceeded. |
| `agent.workspace` | `string` | *(optional)* | Path to a workspace directory. When set, file-based tools operate relative to this directory. |
| `agent.providers` | `ProviderEntry[]` | *(optional)* | Fallback chain of providers. When specified, Haya will try each provider in order if the previous one fails (see below). |
| `agent.toolPolicies` | `ToolPolicy[]` | `[]` | Array of per-tool access policies (see below). |
| `agent.maxContextTokens` | `number` (integer, >= 1000) | *(optional)* | Maximum context window size in tokens. When set, Haya will truncate conversation history to fit within this limit. |

### agent.providers (Fallback Chain)

Each entry in the `providers` array defines an AI provider in the fallback chain. If the first provider fails, the next one is tried, and so on.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | *(required)* | Provider name (e.g., `"openai"`, `"anthropic"`). |
| `apiKeyEnvVar` | `string` | *(required)* | Name of the environment variable holding the API key for this provider. |
| `baseUrl` | `string` | *(optional)* | Custom base URL for the provider's API. Useful for self-hosted or proxy endpoints. |
| `models` | `string[]` | *(optional)* | List of models available from this provider. |

### agent.toolPolicies

Each entry defines an access policy for a specific tool.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `toolName` | `string` | *(required)* | Name of the tool this policy applies to. |
| `level` | `"allow" \| "confirm" \| "deny"` | *(required)* | Access level. `"allow"` permits the tool unconditionally. `"confirm"` requires user confirmation before execution. `"deny"` blocks the tool entirely. |

---

## senderAuth

Controls who can send messages to the assistant. When omitted, sender authentication is disabled entirely.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `senderAuth.mode` | `"open" \| "pairing" \| "allowlist"` | `"open"` | Authorization mode. `"open"` allows all senders. `"pairing"` requires senders to complete a pairing flow (a code is generated and must be approved by an admin). `"allowlist"` only allows pre-approved sender IDs. |
| `senderAuth.dataDir` | `string` | `"data/senders"` | Directory where sender authorization data is stored. |

---

## sessions

Controls session lifecycle and budgets.

### sessions.pruning

Automatic pruning of old or oversized session data.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sessions.pruning.enabled` | `boolean` | `false` | Whether automatic session pruning is enabled. |
| `sessions.pruning.maxAgeDays` | `number` (integer, >= 1) | `90` | Sessions older than this many days are eligible for pruning. |
| `sessions.pruning.maxSizeMB` | `number` (>= 1) | `500` | Maximum total size of session data in megabytes. When exceeded, oldest sessions are pruned first. |

### sessions.budgets

Usage limits to control token and request consumption.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sessions.budgets.maxTokensPerSession` | `number` (integer, >= 0) | *(optional)* | Maximum total tokens allowed per session. When reached, further requests in that session are rejected. |
| `sessions.budgets.maxTokensPerDay` | `number` (integer, >= 0) | *(optional)* | Maximum total tokens allowed per day across all sessions. |
| `sessions.budgets.maxRequestsPerDay` | `number` (integer, >= 0) | *(optional)* | Maximum number of requests allowed per day across all sessions. |

---

## memory

Long-term memory backed by an embedding database.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `memory.enabled` | `boolean` | `false` | Whether long-term memory is enabled. |
| `memory.dbPath` | `string` | *(optional)* | Path to the memory database file. |
| `memory.embeddingProviderApiKeyEnvVar` | `string` | *(optional)* | Name of the environment variable containing the API key for the embedding provider used by the memory subsystem. |

---

## cron

An array of scheduled jobs. Each job triggers an action on a cron schedule.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cron[].name` | `string` | *(required)* | Human-readable name for the job. |
| `cron[].schedule` | `string` | *(required)* | Cron expression defining the schedule (e.g., `"0 3 * * *"` for daily at 3 AM). |
| `cron[].action` | `string` | *(required)* | The action to execute. Built-in actions include `"prune_sessions"`. |
| `cron[].enabled` | `boolean` | `true` | Whether this job is active. Set to `false` to disable without removing. |

---

## plugins

An array of plugin package names to load at startup.

```json5
plugins: ["@haya/plugin-example", "haya-plugin-custom"]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `plugins` | `string[]` | `[]` | List of npm package names (or local paths) for Haya plugins. |

---

## logging

Controls log output.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `logging.level` | `"silly" \| "trace" \| "debug" \| "info" \| "warn" \| "error" \| "fatal"` | `"info"` | Minimum log level. Messages below this level are suppressed. |
| `logging.redactSecrets` | `boolean` | `true` | When `true`, sensitive values (tokens, keys) are redacted from log output. |

---

## tools

Configuration for built-in tool integrations.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tools.googleMapsApiKeyEnvVar` | `string` | *(optional)* | Name of the environment variable containing the Google Maps API key. When set, Google Maps tools (geocoding, directions, places) are registered. |
| `tools.google` | object | *(optional)* | Google OAuth configuration for Calendar, Gmail, and Drive integrations (see below). |

### tools.google

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tools.google.clientIdEnvVar` | `string` | *(required)* | Environment variable name for the Google OAuth client ID. |
| `tools.google.clientSecretEnvVar` | `string` | *(required)* | Environment variable name for the Google OAuth client secret. |
| `tools.google.refreshTokenEnvVar` | `string` | *(optional)* | Environment variable name for a pre-existing Google OAuth refresh token. |
| `tools.google.tokenPath` | `string` | `"data/google-tokens.json"` | File path where OAuth tokens are persisted. |
| `tools.google.calendar.enabled` | `boolean` | `false` | Enable Google Calendar tools (list events, create events). |
| `tools.google.gmail.enabled` | `boolean` | `false` | Enable Gmail tools (read and compose emails). |
| `tools.google.drive.enabled` | `boolean` | `false` | Enable Google Drive tools (read and manage files). |

---

## observability

OpenTelemetry-based observability configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `observability.enabled` | `boolean` | `false` | Whether observability/tracing is enabled. |
| `observability.otlp` | object | *(optional)* | OTLP exporter configuration (see below). |
| `observability.serviceName` | `string` | `"haya"` | The service name reported in traces and metrics. |

### observability.otlp

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `observability.otlp.endpoint` | `string` | *(required)* | The OTLP collector endpoint URL (e.g., `"http://localhost:4318"`). |
| `observability.otlp.headersEnvVar` | `string` | *(optional)* | Environment variable name containing additional HTTP headers for the OTLP exporter (e.g., for authentication). |

---

## Example: Minimal Configuration

The minimal configuration created by `haya init`:

```json
{
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "<generated-64-hex-char-token>"
    },
    "trustedProxies": []
  },
  "agent": {
    "defaultModel": "gpt-4o",
    "defaultProviderApiKeyEnvVar": "OPENAI_API_KEY",
    "systemPrompt": "You are a helpful assistant responding to users in a chat conversation. Reply directly and concisely.",
    "maxHistoryMessages": 100,
    "toolPolicies": []
  },
  "cron": [],
  "plugins": []
}
```

## Example: Full Configuration

A comprehensive configuration using JSON5 syntax with most features enabled:

```json5
{
  // Gateway settings
  gateway: {
    port: 18789,
    bind: "lan",
    auth: {
      mode: "token",
      token: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    },
    tls: {
      enabled: true,
      certPath: "/etc/haya/tls/cert.pem",
      keyPath: "/etc/haya/tls/key.pem",
    },
    trustedProxies: ["10.0.0.0/8", "172.16.0.0/12"],
  },

  // AI agent settings
  agent: {
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
    defaultProviderApiKeyEnvVar: "OPENAI_API_KEY",
    systemPrompt: "You are Haya, a personal AI assistant. Be helpful, concise, and friendly.",
    systemPromptFiles: ["prompts/rules.md", "prompts/persona.md"],
    maxHistoryMessages: 200,
    maxContextTokens: 128000,
    workspace: "/home/user/projects",
    providers: [
      {
        name: "openai",
        apiKeyEnvVar: "OPENAI_API_KEY",
        models: ["gpt-4o", "gpt-4o-mini"],
      },
      {
        name: "anthropic",
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        models: ["claude-sonnet-4-20250514"],
      },
    ],
    toolPolicies: [
      { toolName: "web_fetch", level: "allow" },
      { toolName: "file_write", level: "confirm" },
      { toolName: "shell_exec", level: "deny" },
    ],
  },

  // Sender authorization
  senderAuth: {
    mode: "pairing",
    dataDir: "data/senders",
  },

  // Session management
  sessions: {
    pruning: {
      enabled: true,
      maxAgeDays: 30,
      maxSizeMB: 200,
    },
    budgets: {
      maxTokensPerSession: 500000,
      maxTokensPerDay: 2000000,
      maxRequestsPerDay: 500,
    },
  },

  // Long-term memory
  memory: {
    enabled: true,
    dbPath: "data/memory.db",
    embeddingProviderApiKeyEnvVar: "OPENAI_API_KEY",
  },

  // Scheduled jobs
  cron: [
    {
      name: "nightly-prune",
      schedule: "0 3 * * *",
      action: "prune_sessions",
      enabled: true,
    },
  ],

  // Plugins
  plugins: ["@haya/plugin-example"],

  // Logging
  logging: {
    level: "info",
    redactSecrets: true,
  },

  // Tool integrations
  tools: {
    googleMapsApiKeyEnvVar: "GOOGLE_MAPS_API_KEY",
    google: {
      clientIdEnvVar: "GOOGLE_CLIENT_ID",
      clientSecretEnvVar: "GOOGLE_CLIENT_SECRET",
      tokenPath: "data/google-tokens.json",
      calendar: { enabled: true },
      gmail: { enabled: true },
      drive: { enabled: false },
    },
  },

  // Observability
  observability: {
    enabled: true,
    otlp: {
      endpoint: "http://localhost:4318",
      headersEnvVar: "OTEL_EXPORTER_OTLP_HEADERS",
    },
    serviceName: "haya",
  },
}
```
