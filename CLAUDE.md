# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test                    # or: pnpm vitest run

# Run a single test file
pnpm vitest run packages/core/src/agent/bedrock.test.ts

# Run tests matching a pattern
pnpm vitest run -t "streaming"

# Watch mode
pnpm test:watch

# Type check (no emit)
pnpm lint                    # runs: tsc --noEmit

# Dev server (runs entry.ts with tsx)
pnpm dev start -c haya.json

# Security audit
pnpm dev audit
```

## Project Overview

Haya is a personal AI assistant gateway. It connects messaging platforms (Slack, Discord, Telegram, WhatsApp, etc.) to AI providers (OpenAI, Anthropic, AWS Bedrock) through a secure gateway with WebSocket and HTTP APIs.

## Monorepo Structure

- **pnpm workspaces** with `packages/*` and `extensions/*`
- **`packages/core`** — all core logic (gateway, agent, config, sessions, security, etc.)
- **`extensions/`** — channel plugins (slack, discord, telegram, whatsapp, webhook, teams, google-chat, irc, signal). Each is a separate package (`@haya/slack`, `@haya/discord`, etc.)
- **`packages/plugin-sdk`** — SDK for building plugins

TypeScript config: `ES2024` target, `NodeNext` module resolution, strict mode. All source uses `.js` extensions in imports (NodeNext convention).

## Architecture

### Request Flow

```
Channel (Slack/Discord/etc) → ChannelDock → MessageRouter → AgentRuntime → AIProvider → Response → Channel
```

### Core Subsystems (all in `packages/core/src/`)

- **`agent/`** — AI provider abstraction and tool execution
  - `providers.ts` — factory `createProvider()` returning `AIProvider` (OpenAI, Anthropic, Bedrock)
  - `bedrock.ts` — AWS Bedrock Converse API provider (lazy-loads `@aws-sdk/client-bedrock-runtime`)
  - `runtime.ts` — `AgentRuntime` class: message→AI→tool call loop→response pipeline
  - `tools.ts` — `ToolRegistry` for registering and executing tools
  - `tool-policy.ts` — `ToolPolicyEngine` (allow/confirm/deny per tool)
  - `types.ts` — shared types: `Message`, `ProviderConfig`, `AIProvider`, `AgentTool`, etc.
  - `retry.ts` — `withRetry()` with exponential backoff, `RetryableProviderError`

- **`config/`** — Configuration loading and validation
  - `schema.ts` — Zod schemas (`AssistantConfigSchema`)
  - `loader.ts` — `loadConfig()` / `saveConfig()` / `initializeConfig()` (supports JSON and JSON5)
  - `validation.ts` — cross-field validation beyond Zod (TLS requirements, provider-specific checks)
  - `types.ts` — inferred TypeScript types from Zod schemas

- **`gateway/`** — HTTP (Express 5) + WebSocket (ws) server
  - `server.ts` / `server-http.ts` / `server-ws.ts` — gateway creation and lifecycle
  - `server-methods/` — JSON-RPC method handlers (chat, sessions, channels, cron)
  - `protocol/` — frame parsing, schema, error codes
  - `auth.ts` — token/password authentication
  - `csp.ts` / `tls.ts` / `net.ts` — security utilities
  - `webchat/` — built-in web chat UI

- **`channels/`** — Messaging platform integration
  - `registry.ts` — `ChannelRegistry` for managing channel plugins
  - `dock.ts` — `ChannelDock` lifecycle manager (start/stop all channels)
  - `router.ts` — `MessageRouter` for group chat filtering (@mentions)
  - `types.ts` — `ChannelPlugin` interface that extensions implement

- **`sessions/`** — Conversation persistence
  - `store.ts` — `SessionStore` (file-based JSON storage in `sessions/` dir)
  - `history.ts` — `HistoryManager` wrapping store with message limits
  - `budget.ts` — `BudgetEnforcer` for per-session/per-day token limits
  - `usage.ts` — `UsageTracker` for token usage statistics

- **`security/`** — Security subsystem
  - `sender-auth.ts` — `SenderAuthManager` (allowlist/pairing mode)
  - `workspace.ts` — `WorkspaceGuard` restricting file access to project directory
  - `audit.ts` — security audit checks
  - `plugin-sandbox.ts` — sandboxed worker threads for plugins

- **`entry.ts`** — CLI entry point using Commander.js. All commands (`start`, `init`, `doctor`, `onboard`, `audit`, `usage`, `cron`, `channels`, `senders`, `google`)

### Key Patterns

- **Lazy dynamic imports** — Heavy dependencies loaded via `import()` only when needed (e.g., Bedrock SDK, channel plugins, Google Auth). The `entry.ts` command handlers all use dynamic imports.
- **Provider abstraction** — All AI providers implement `AIProvider` interface with `complete()` and optional `completeStream()`. The `createProvider()` factory dispatches by provider name.
- **Config-driven** — `haya.json` (or `.json5`) is the single config file. Zod schema validates structure; `validation.ts` handles cross-field rules.
- **File permissions** — Config files saved with `0o600` permissions. The loader auto-fixes loose permissions on load.
- **Channel auto-detection** — Channels are registered based on environment variables (e.g., `SLACK_BOT_TOKEN` → Slack channel).

## Testing

- **Framework**: Vitest with `pool: "forks"`, 30s timeout, `unstubEnvs`/`unstubGlobals` enabled
- **Test location**: Co-located `*.test.ts` files next to source
- **Mocking**: `vi.mock()` for modules, `vi.stubEnv()` for env vars, `vi.spyOn()` for method spies
- **Coverage**: V8 provider, excludes `*.test.ts`, `index.ts`, `entry.ts`

## Development Rules

### Code Conventions
- Named exports only — no default exports
- Use `import type` for type-only imports
- Import order: Node builtins → third-party → local modules → type imports
- File names: kebab-case (`tool-policy.ts`). Classes: PascalCase. Functions/variables: camelCase
- Factory functions prefixed with `create` (e.g., `createProvider()`, `createGateway()`)
- Derive config types from Zod schemas via `z.infer<>` — don't duplicate type definitions manually
- Use `.js` extensions in all import paths (NodeNext module resolution)

### Testing
- Tests are required for every new feature, bug fix, or behavioral change
- Co-locate test files with source: `foo.ts` → `foo.test.ts`
- Unit tests for individual functions/classes; integration tests when multiple subsystems interact
- Run full suite (`pnpm test`) and type check (`pnpm lint`) before considering work complete

### Documentation
- Add JSDoc comments on exported functions and types
- Update CLAUDE.md if architecture, commands, or config schema changes
- Add inline comments only for non-obvious logic
- Update the Config File section below when adding new config fields

### Error Handling
- Use custom error classes from `infra/errors.ts` (`ConfigError`, `AuthError`, `ValidationError`, `NotFoundError`, `RateLimitError`) — never throw raw strings
- Tool execution errors should be returned as `ToolResult` with `isError: true`, not thrown
- Chain underlying errors via the `cause` property

### Security
- Never store secrets in config files — reference env var names only, resolve at runtime via `resolveSecret()` / `requireSecret()` from `config/secrets.ts`
- Validate external input at system boundaries (session IDs, file paths, user content)
- Use `safeExecSync()` from `security/command-exec.ts` instead of raw `execSync` — it prevents shell injection
- Config files must use `0o600` permissions; session directories `0o700`

### Parallel Development Workflow
- When building features, split work into as many independent tasks as possible and develop them in parallel without overlap
- Each task/feature must be developed on its own branch (e.g., `feat/add-xyz`, `fix/session-bug`)
- Merge feature branches back to `main` when complete and tested
- Ensure branches do not modify the same files to avoid merge conflicts — design task boundaries around separate files/modules
- Each branch must pass `pnpm test` and `pnpm lint` before merging

### Gotchas
- Optional/heavy dependencies (Bedrock SDK, channel plugins) must be lazy-loaded via dynamic `import()` — never add to top-level imports
- Config supports JSON5 (comments, trailing commas) — use `json5` parser, not `JSON.parse`
- Session files use JSONL format (one JSON object per line), not plain JSON
- `completeStream()` is optional on `AIProvider` — always check before calling

## Config File

The main config is `haya.json` at project root. Key sections:
- `gateway` — port, bind mode (loopback/lan/custom), auth (token/password), TLS, trustedProxies
- `agent` — defaultProvider, defaultModel, defaultProviderApiKeyEnvVar, awsRegion, systemPrompt, toolPolicies, maxHistoryMessages
- `cron` — scheduled jobs
- `plugins` — plugin definitions
- `tools` — Google Maps, Google OAuth (Calendar/Gmail/Drive)
- `senderAuth` — sender authorization (allowlist/pairing)
- `sessions.pruning` — auto-pruning old sessions
