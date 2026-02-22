# Architecture

Detailed system design for Haya.

## Overview

Haya is a personal AI assistant gateway that connects messaging channels to AI models. It is structured as a pnpm monorepo with three workspaces:

- `packages/core` -- Main application (gateway, agent, config, security, memory, plugins, channels, cron, observability)
- `packages/plugin-sdk` -- Published SDK for plugin authors
- `extensions/slack` -- Slack channel integration
- `extensions/teams` -- Microsoft Teams channel integration

## Technology stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Node.js 22+ | Platform (with native SQLite) |
| Language | TypeScript 5.8+ | Strict mode, ES2024 target |
| Package Manager | pnpm 10 | Monorepo workspaces |
| HTTP Server | Express 5 | Gateway HTTP layer |
| WebSocket | ws 8 | Gateway control plane |
| Validation | Zod 3 | Schema-first type safety |
| Database | node:sqlite + sqlite-vec | Memory system (FTS5 + vector) |
| Scheduling | croner 10 | Cron job execution |
| Logging | tslog 4 | Structured logging with redaction |
| Config | JSON5 | Config files with comments and trailing commas |
| Observability | OpenTelemetry | OTLP/HTTP traces and metrics |
| CLI | commander 14 | Command-line interface |
| Build | tsdown (rolldown) | Production builds |
| Testing | Vitest 3 | Unit and integration tests |

## Component architecture

### Gateway

The gateway is the central entry point. It provides:

- **HTTP server** (`server-http.ts`) -- Express 5 with security headers, CSP, health endpoint
- **WebSocket server** (`server-ws.ts`) -- JSON-RPC protocol, method dispatch, Zod validation
- **Web chat UI** (`/chat`) -- Embedded HTML/CSS/JS chat interface with CSP nonce; served directly by the gateway for browser-based interaction without external dependencies
- **Authentication** (`auth.ts`) -- Mandatory token or password auth, no "none" mode
- **Rate limiting** (`auth-rate-limit.ts`) -- Per-client-IP with proxy awareness
- **TLS** (`tls.ts`) -- ECDSA P-384, 90-day certs, TLS 1.3 minimum
- **CSP** (`csp.ts`) -- Nonce-based, wss: only
- **Network** (`net.ts`) -- IP resolution, trusted proxy validation, loopback detection

### Agent runtime

The agent runtime manages AI interactions:

- **Runtime** (`runtime.ts`) -- Message -> AI -> response pipeline with streaming support
- **Providers** (`providers.ts`) -- AI provider abstraction (OpenAI, Anthropic, Bedrock); model-pattern routing dispatches requests based on glob patterns (e.g. `gpt-*` -> OpenAI, `claude-*` -> Anthropic)
- **Provider resilience** -- Retry with exponential backoff on 429/503 errors, then fallback to next provider in chain
- **Response streaming** -- SSE parser feeds an AsyncGenerator that emits `chat.delta` events for progressive delivery to clients
- **Context compaction** -- Token-aware context management that compacts conversation history when approaching model token limits
- **Budget enforcement** -- Per-session and per-day token usage limits; requests are rejected when budget is exhausted
- **Tools** (`tools.ts`) -- Tool execution framework for function calling
- **Tool policies** -- Per-tool access control with allow/confirm/deny modes
- **Google Calendar** (`google-calendar-tools.ts`) -- 7 tools (list/search/create/update/delete events, list calendars, freebusy)
- **Gmail** (`google-gmail-tools.ts`) -- 6 tools (search, read, thread, labels, draft, send draft)
- **Google Drive** (`google-drive-tools.ts`) -- 5 tools (search, read, list folder, create, share)
- **Google Maps** (`google-maps-tools.ts`) -- Location and mapping tools

### Session management

- **Store** (`store.ts`) -- JSONL-based session persistence with `0o600` file permissions
- **History** (`history.ts`) -- Conversation history management with configurable limits

### Memory system

Hybrid search combining full-text and vector similarity:

- **SQLite** (`sqlite.ts`) -- Native `node:sqlite` wrapper with FTS5 full-text search
- **sqlite-vec** (`sqlite-vec.ts`) -- Vector similarity search extension
- **Hybrid** (`hybrid.ts`) -- BM25 + cosine similarity score merging
- **Embeddings** (`embeddings.ts`) -- Embedding provider abstraction
- **Manager** (`manager.ts`) -- High-level memory indexing and search API

### Plugin system

Sandboxed plugin execution:

- **Registry** (`registry.ts`) -- Plugin lifecycle management
- **Loader** (`loader.ts`) -- Sandboxed loading via worker_threads
- **Hooks** (`hooks.ts`) -- Event dispatch system
- **Sandbox** (`plugin-sandbox.ts`) -- Node.js 22+ permission model enforcement

### Channel framework

Messaging integration abstraction:

- **Types** (`types.ts`) -- ChannelPlugin interface with capabilities, config, runtime
- **Registry** (`registry.ts`) -- Channel registration
- **Router** (`router.ts`) -- Inbound message routing across channels
- **Dock** (`dock.ts`) -- Channel lifecycle (start, stop, restart, status), message routing
- **Sender auth** (`sender-auth.ts`) -- Per-channel sender authentication (open, pairing, allowlist modes)
- **Workspace guard** -- Restricts channel access to authorized workspaces

Supported channels (9):

| Channel | Transport |
|---------|-----------|
| Slack | Socket Mode via @slack/bolt (`extensions/slack`) |
| Microsoft Teams | Bot Framework (`extensions/teams`) |
| Discord | Discord.js gateway |
| Telegram | Bot API long-polling |
| WhatsApp | Cloud API webhooks |
| Webhook | Generic HTTP POST endpoint |
| Signal | Signal CLI / REST API |
| Google Chat | Google Chat API |
| IRC | IRC protocol |

### Cron service

Scheduled job execution:

- **Service** (`service.ts`) -- Job scheduling with croner, dynamic add/remove
- **Store** (`store.ts`) -- Job persistence to JSON file

### Google OAuth

Shared OAuth2 authentication for Google Calendar, Gmail, and Drive tools:

- **Auth** (`google/auth.ts`) -- Token lifecycle: auto-refresh, browser consent flow, token storage (`0o600`), revocation
- No external OAuth libraries -- uses native `fetch()` for token refresh and `http.createServer()` for the consent callback
- Configurable via `tools.google` in `haya.json`; credentials via `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` env vars
- CLI: `haya google auth` (interactive consent) and `haya google revoke` (token cleanup)

### Config system

Zod-first configuration with JSON5 support:

- **Schema** (`schema.ts`) -- Full config schema with mandatory auth
- **Types** (`types.ts`) -- TypeScript types derived from Zod
- **Loader** (`loader.ts`) -- JSON5 config file I/O (supports comments, trailing commas); auto-generation of tokens on first run
- **Hot-reload** -- File watcher detects config changes; safe fields (e.g. logging level, cron jobs) are applied without restart; unsafe fields (e.g. auth, TLS, port) require a restart and log a warning
- **Prompt assembly** -- System prompts composed from external files referenced in config, merged at load time
- **Secrets** (`secrets.ts`) -- Environment variable resolution (never stores actual secrets)
- **Validation** (`validation.ts`) -- Cross-field validation (e.g., TLS required for non-loopback)

### Security

Dedicated security modules:

- **secret-equal.ts** -- SHA-256 hash-padded constant-time comparison
- **command-exec.ts** -- Safe exec with `execFileSync`, `shell: false`
- **external-content.ts** -- Prompt injection wrapping with boundary markers
- **plugin-sandbox.ts** -- worker_threads with permission model
- **audit.ts** -- Built-in 20-check security audit runner

### Observability

- **OpenTelemetry** -- OTLP/HTTP exporter for traces and metrics; spans cover provider calls, tool execution, and channel message handling
- **Logger** (`logger.ts`) -- tslog with sensitive key redaction (maskValuesOfKeys)
- **Errors** (`errors.ts`) -- Typed error hierarchy (AppError, ConfigError, AuthError, etc.)

## Data flow

### Inbound message (channel -> agent)

```
Channel (e.g., Slack, Discord, Telegram)
  -> ChannelPlugin.start() registers onMessage callback
  -> Inbound message received from external service
  -> Sender auth check (open / pairing / allowlist)
  -> wrapExternalContent() applies prompt injection protection
  -> Channel router dispatches to agent runtime
  -> Agent runtime processes message with AI provider
  -> Provider retry (exponential backoff on 429/503) -> fallback chain
  -> Response streamed back via ChannelPlugin.sendMessage()
```

### Response streaming pipeline

```
AI Provider API (SSE stream)
  -> SSE parser decodes server-sent events
  -> AsyncGenerator yields incremental tokens
  -> chat.delta events emitted to client / channel
  -> Final chat.complete event with full response
  -> Token usage recorded for budget enforcement
```

### Provider resilience (retry -> fallback)

```
Request to primary provider (e.g., OpenAI)
  -> On 429/503: retry with exponential backoff (configurable max retries)
  -> On persistent failure: fallback to next provider in chain
  -> Model-pattern routing selects provider (gpt-* -> OpenAI, claude-* -> Anthropic)
  -> Bedrock provider available as fallback for Anthropic models
```

### Gateway request (client -> gateway)

```
WebSocket client connects with auth token
  -> auth.ts validates token (constant-time comparison)
  -> rate limiter checks per-client-IP limits
  -> Client sends JSON-RPC request { id, method, params }
  -> server-ws.ts validates frame with Zod
  -> Method handler processes request
  -> Response { id, result } sent back (or streamed via SSE)
```

### Web chat request (browser -> /chat)

```
Browser requests GET /chat
  -> server-http.ts serves embedded HTML/CSS/JS with CSP nonce
  -> User sends message via chat UI
  -> Request authenticated with gateway token
  -> Response streamed via SSE to browser
```

## Deployment

### Docker

Multi-stage build:
1. **Build stage**: Install deps, compile TypeScript, prune dev deps
2. **Production stage**: Copy dist + production node_modules, run as `haya` user (UID 1000)

Security hardening:
- Non-root user (`haya`, UID 1000)
- Read-only filesystem
- No new privileges
- All capabilities dropped
- tmpfs for /tmp

### CI/CD

GitHub Actions with 4 jobs:
1. **lint** -- TypeScript type check
2. **test** -- Vitest test suite
3. **build** -- Production build
4. **docker** -- Docker image build verification
