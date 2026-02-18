# Architecture

Detailed system design for Haya.

## Overview

Haya is a personal AI assistant gateway that connects messaging channels to AI models. It is structured as a pnpm monorepo with three workspaces:

- `packages/core` -- Main application (gateway, agent, config, security, memory, plugins, channels, cron)
- `packages/plugin-sdk` -- Published SDK for plugin authors
- `extensions/slack` -- Slack channel integration

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
| CLI | commander 14 | Command-line interface |
| Build | tsdown (rolldown) | Production builds |
| Testing | Vitest 3 | Unit and integration tests |

## Component architecture

### Gateway

The gateway is the central entry point. It provides:

- **HTTP server** (`server-http.ts`) -- Express 5 with security headers, CSP, health endpoint
- **WebSocket server** (`server-ws.ts`) -- JSON-RPC protocol, method dispatch, Zod validation
- **Authentication** (`auth.ts`) -- Mandatory token or password auth, no "none" mode
- **Rate limiting** (`auth-rate-limit.ts`) -- Per-client-IP with proxy awareness
- **TLS** (`tls.ts`) -- ECDSA P-384, 90-day certs, TLS 1.3 minimum
- **CSP** (`csp.ts`) -- Nonce-based, wss: only
- **Network** (`net.ts`) -- IP resolution, trusted proxy validation, loopback detection

### Agent runtime

The agent runtime manages AI interactions:

- **Runtime** (`runtime.ts`) -- Message -> AI -> response pipeline
- **Providers** (`providers.ts`) -- AI provider abstraction (OpenAI, Anthropic, etc.)
- **Tools** (`tools.ts`) -- Tool execution framework for function calling

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
- **Dock** (`dock.ts`) -- Channel lifecycle (start, stop, restart, status), message routing

### Cron service

Scheduled job execution:

- **Service** (`service.ts`) -- Job scheduling with croner, dynamic add/remove
- **Store** (`store.ts`) -- Job persistence to JSON file

### Config system

Zod-first configuration:

- **Schema** (`schema.ts`) -- Full config schema with mandatory auth
- **Types** (`types.ts`) -- TypeScript types derived from Zod
- **Loader** (`loader.ts`) -- Config file I/O, auto-generation of tokens on first run
- **Secrets** (`secrets.ts`) -- Environment variable resolution (never stores actual secrets)
- **Validation** (`validation.ts`) -- Cross-field validation (e.g., TLS required for non-loopback)

### Security

Dedicated security modules:

- **secret-equal.ts** -- SHA-256 hash-padded constant-time comparison
- **command-exec.ts** -- Safe exec with `execFileSync`, `shell: false`
- **external-content.ts** -- Prompt injection wrapping with boundary markers
- **plugin-sandbox.ts** -- worker_threads with permission model
- **audit.ts** -- Built-in 20-check security audit runner

### Infrastructure

- **Logger** (`logger.ts`) -- tslog with sensitive key redaction (maskValuesOfKeys)
- **Errors** (`errors.ts`) -- Typed error hierarchy (AppError, ConfigError, AuthError, etc.)

## Data flow

### Inbound message (channel -> agent)

```
Channel (e.g., Slack)
  -> ChannelPlugin.start() registers onMessage callback
  -> Inbound message received from external service
  -> wrapExternalContent() applies prompt injection protection
  -> ChannelRuntime.onMessage(msg) delivers to agent
  -> Agent runtime processes message with AI provider
  -> Response sent back via ChannelPlugin.sendMessage()
```

### Gateway request (client -> gateway)

```
WebSocket client connects with auth token
  -> auth.ts validates token (constant-time comparison)
  -> rate limiter checks per-client-IP limits
  -> Client sends JSON-RPC request { id, method, params }
  -> server-ws.ts validates frame with Zod
  -> Method handler processes request
  -> Response { id, result } sent back
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
