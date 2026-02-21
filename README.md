# Haya

Personal AI assistant gateway. Connects messaging channels (Slack, Discord, Telegram) to AI models through a secure WebSocket control plane, with plugin system, memory search, session management, and cron automation.

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

The gateway starts on port 18789 (configurable) and requires authentication on every connection.

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

## Architecture

```
Messaging Channels (Slack, Discord, Telegram)
        |  (inbound messages via channel plugins)
        v
+-----------------------------------------------+
|           Gateway Server (WebSocket)           |
|  Port 18789 (configurable)                     |
|                                                |
|  Auth ........... MANDATORY (token | password) |
|  TLS ............ Required for non-loopback    |
|  Rate Limiting .. Proxy-aware, per-client-IP   |
|  Protocol ....... JSON-RPC, Zod-validated      |
+-----------------------------------------------+
        |
        +---> Agent Runtime ---> AI Provider APIs
        +---> Session Manager ---> JSONL on disk
        +---> Memory Manager ---> SQLite + sqlite-vec
        +---> Cron Service ---> Scheduled automation
        +---> Plugin Registry ---> Sandboxed worker_threads
```

See [docs/architecture.md](docs/architecture.md) for the full system design.

## Project structure

```
packages/
  core/           Main application (gateway, agent, config, security)
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
pnpm dev start                              # Start the gateway
pnpm dev start --port 9000                  # Custom port
pnpm dev audit                              # Security audit
pnpm dev channels list                      # List channels
pnpm dev cron list                          # List cron jobs
pnpm dev cron add -n "daily" -s "0 9 * * *" -a "summarize"  # Add job
pnpm dev config show                        # Show config (redacted)
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
- [Slack Setup](docs/slack-setup.md) -- Slack integration guide
- [Teams Setup](docs/teams-setup.md) -- Microsoft Teams integration guide
- [Onboarding](docs/onboarding.md) -- Getting started for new developers
- [Contributing](CONTRIBUTING.md) -- How to contribute

## License

Private project.
