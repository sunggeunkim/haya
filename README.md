# Haya

Personal AI assistant gateway. Connects messaging channels (Slack, Discord, Telegram, WhatsApp, and more) to AI models through a secure WebSocket control plane, with plugin system, memory search, session management, cron automation, and a built-in web chat UI.

Haya is a clean-room reimplementation of [OpenClaw](https://github.com/openclaw/openclaw) that preserves the strong architectural patterns while systematically eliminating all 20 identified security vulnerabilities.

## Quickstart

### Prerequisites

- Node.js 22.12.0+
- pnpm 10.11.0+

### Install and run

```bash
# Clone the repository
git clone https://github.com/sunggeunkim/haya.git
cd haya

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Generate a gateway token
echo "ASSISTANT_GATEWAY_TOKEN=$(openssl rand -hex 32)" >> .env

# Add your AI provider key
echo "OPENAI_API_KEY=your-key-here" >> .env

# Start the gateway
pnpm dev start
```

The gateway starts on port 18789 (configurable) and requires authentication on every connection. A web chat UI is available at `http://localhost:18789/chat`.

### Health check

```bash
curl http://localhost:18789/health
# => {"status":"ok"}
```

### Docker

```bash
# Build and run with Docker Compose
docker compose up -d

# Or build standalone
docker build -t haya --target production .
docker run -p 18789:18789 --env-file .env haya
```

## Features

- **Multi-provider AI** -- OpenAI, Anthropic, Bedrock; provider fallback chain with model-pattern routing (e.g. `gpt-*` -> OpenAI, `claude-*` -> Anthropic)
- **Response streaming** -- SSE-based progressive delivery of AI responses
- **Provider resilience** -- Automatic retry with exponential backoff on 429/503 errors
- **9 messaging channels** -- Slack, Microsoft Teams, Discord, Telegram, WhatsApp, Webhook, Signal, Google Chat, IRC
- **Built-in web chat UI** -- Embedded chat interface served at `/chat`
- **Tool system** -- Google Calendar, Gmail, Drive, Maps, and custom tools via plugin SDK
- **Tool policies** -- Per-tool allow/confirm/deny access control
- **Sender authentication** -- Open, pairing, or allowlist modes for channel access
- **Token-aware context compaction** -- Automatic context management to stay within model limits
- **Budget limits** -- Per-session and per-day token usage enforcement
- **Memory system** -- Hybrid search with SQLite FTS5 + sqlite-vec vector similarity
- **Session management** -- JSONL-based persistence with configurable history limits
- **Cron automation** -- Scheduled jobs with croner
- **Plugin system** -- Sandboxed worker_threads with Node.js 22+ permission model
- **JSON5 config** -- Config files support comments and trailing commas
- **Config hot-reload** -- Safe fields updated without restart
- **System prompt assembly** -- Compose system prompts from external files
- **OpenTelemetry** -- OTLP/HTTP traces and metrics integration
- **Security-first** -- Mandatory auth, TLS, CSP, constant-time secrets, prompt injection protection

## Channels

| Channel | Transport | Package |
|---------|-----------|---------|
| Slack | Socket Mode (@slack/bolt) | `extensions/slack` |
| Microsoft Teams | Bot Framework | `extensions/teams` |
| Discord | Discord.js gateway | `packages/core` |
| Telegram | Bot API long-polling | `packages/core` |
| WhatsApp | Cloud API webhooks | `packages/core` |
| Webhook | Generic HTTP POST | `packages/core` |
| Signal | Signal CLI / REST API | `packages/core` |
| Google Chat | Google Chat API | `packages/core` |
| IRC | IRC protocol | `packages/core` |

## Architecture

```
Messaging Channels (Slack, Teams, Discord, Telegram, WhatsApp, Webhook, Signal, Google Chat, IRC)
        |  (inbound messages via channel plugins)
        v
+-----------------------------------------------+
|           Gateway Server (HTTP + WebSocket)    |
|  Port 18789 (configurable)                     |
|                                                |
|  Auth ........... MANDATORY (token | password) |
|  TLS ............ Required for non-loopback    |
|  Rate Limiting .. Proxy-aware, per-client-IP   |
|  Protocol ....... JSON-RPC, Zod-validated      |
|  Web Chat ...... /chat (embedded UI, CSP nonce)|
|  Streaming ..... SSE progressive delivery      |
|  Observability . OpenTelemetry OTLP/HTTP       |
+-----------------------------------------------+
        |
        +---> Agent Runtime ---> AI Provider APIs (OpenAI, Anthropic, Bedrock)
        |       +---> Retry (exponential backoff) -> Fallback chain
        |       +---> Response streaming (SSE -> AsyncGenerator)
        |       +---> Token-aware context compaction
        |       +---> Budget enforcement (per-session, per-day)
        |       +---> Google Tools (Calendar, Gmail, Drive, Maps)
        +---> Session Manager ---> JSONL on disk
        +---> Memory Manager ---> SQLite + sqlite-vec
        +---> Cron Service ---> Scheduled automation
        +---> Plugin Registry ---> Sandboxed worker_threads
```

See [docs/architecture.md](docs/architecture.md) for the full system design.

## Project structure

```
packages/
  core/           Main application (gateway, agent, config, security, channels)
    src/
      google/     Google OAuth2 auth layer (shared by Calendar/Gmail/Drive)
      agent/      AI runtime, providers, tools, streaming, context compaction
      config/     JSON5 loader, hot-reload, validation, prompt assembly
      channels/   Discord, Telegram, WhatsApp, Webhook, Signal, Google Chat, IRC
      gateway/    HTTP server, WebSocket server, web chat UI, SSE
  plugin-sdk/     SDK for plugin authors

extensions/
  slack/          Slack channel integration (@slack/bolt Socket Mode)
  teams/          Microsoft Teams channel integration (Bot Framework)
```

## Development

```bash
pnpm test              # Run all tests
pnpm lint              # Type check (tsc --noEmit)
pnpm build             # Build for production
pnpm test:coverage     # Tests with coverage
pnpm audit:security    # Run security audit (20 checks)
```

## CLI

```bash
pnpm dev init                               # Create config (haya.json5)
pnpm dev start                              # Start the gateway
pnpm dev start --port 9000                  # Custom port
pnpm dev channels list                      # List configured channels
pnpm dev cron list                          # List cron jobs
pnpm dev cron add -n "daily" -s "0 9 * * *" -a "summarize"  # Add cron job
pnpm dev cron remove -n "daily"             # Remove cron job
pnpm dev senders approve <id>               # Approve a sender
pnpm dev senders list                       # List authorized senders
pnpm dev config show                        # Show config (secrets redacted)
pnpm dev audit                              # Run security audit
pnpm dev doctor                             # Run diagnostic checks
pnpm dev onboard                            # Interactive setup wizard
pnpm dev usage                              # Show token usage statistics
pnpm dev google auth                        # Google OAuth consent flow
pnpm dev google revoke                      # Revoke Google tokens
```

## Security

Haya addresses all 20 security vulnerabilities found in OpenClaw:

- **3 Critical**: No eval(), no shell injection, mandatory authentication
- **7 High**: Constant-time secrets, prompt injection protection, TLS, sandboxed plugins
- **9 Medium**: Zod validation, env-only secrets, nonce CSP, logging redaction
- **1 Low**: No curl|bash in Docker

Run `pnpm audit:security` to verify. See [docs/security.md](docs/security.md) for details.

## Documentation

- [Architecture](docs/architecture.md) -- System design and component overview
- [Security](docs/security.md) -- Security model and vulnerability fixes
- [API Reference](docs/api.md) -- Gateway protocol and methods
- [Plugin Development](docs/plugins.md) -- Building plugins with the SDK
- [Google Setup](docs/google-setup.md) -- Google Calendar, Gmail & Drive setup
- [Slack Setup](docs/slack-setup.md) -- Slack integration guide
- [Teams Setup](docs/teams-setup.md) -- Microsoft Teams integration guide
- [Onboarding](docs/onboarding.md) -- Getting started for new developers
- [Contributing](CONTRIBUTING.md) -- How to contribute

## License

Private project.
