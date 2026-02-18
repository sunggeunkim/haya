# Onboarding Guide

Getting started guide for new developers working on Haya.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22.12.0+ | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | 10.11.0 | `corepack enable && corepack prepare pnpm@10.11.0 --activate` |

## First-time setup

```bash
git clone https://github.com/sunggeunkim/haya.git
cd haya
pnpm install
```

## Environment

```bash
cp .env.example .env
```

Fill in the required values:

| Variable | Required | Description |
|----------|----------|-------------|
| `ASSISTANT_GATEWAY_TOKEN` | Yes | Gateway auth token. Generate: `openssl rand -hex 32` |
| `OPENAI_API_KEY` | Yes | AI provider API key |
| `SLACK_BOT_TOKEN` | No | Slack bot token (for Slack channel) |
| `SLACK_APP_TOKEN` | No | Slack app token for Socket Mode |
| `SLACK_SIGNING_SECRET` | No | Slack signing secret |
| `EMBEDDING_API_KEY` | No | Embedding provider key (for memory vector search) |

## Running locally

```bash
# Development mode (with tsx, no build required)
pnpm dev start

# With custom port
pnpm dev start --port 9000

# With a specific config file
pnpm dev start --config path/to/config.json
```

## Running tests

```bash
pnpm test              # Run all tests (currently 485)
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage report
pnpm lint              # Type check
```

## Project layout

```
haya/
  package.json              Root workspace config
  pnpm-workspace.yaml       Workspace definition
  tsconfig.json              Shared TypeScript config
  tsdown.config.ts           Build config (rolldown-based)
  vitest.config.ts           Test config
  Dockerfile                 Multi-stage production build
  docker-compose.yml         Docker deployment
  .env.example               Environment template
  .github/workflows/ci.yml   CI pipeline

  packages/
    core/                    Main application
      src/
        entry.ts             CLI entry point (commander)
        index.ts             Package exports
        config/              Zod schema, loader, secrets, validation
        gateway/             HTTP server, WebSocket, auth, TLS, CSP
        security/            Secret comparison, command exec, sandbox, audit
        agent/               AI runtime, providers, tool execution
        sessions/            Session store, history (JSONL)
        memory/              SQLite + sqlite-vec hybrid search
        plugins/             Plugin registry, loader, hooks
        channels/            Channel framework (types, registry, dock)
        cron/                Cron scheduler and job store
        infra/               Logger, error types

    plugin-sdk/              SDK for plugin authors
      src/index.ts           Re-exports plugin types

  extensions/
    slack/                   Slack channel (@slack/bolt, Socket Mode)
      src/
        index.ts             Channel plugin implementation
        config.ts            Slack configuration helpers
```

## Key concepts

### Config system

Configuration is defined by a Zod schema (`config/schema.ts`). The config file stores structure and env var references, never actual secrets. Secrets are resolved at runtime from `process.env`.

### Gateway protocol

The gateway uses a JSON-RPC-style protocol over WebSocket. Clients send requests with `{ id, method, params }` and receive `{ id, result }` or `{ id, error: { code, message } }`. The server can also push events `{ event, data }`.

### Security model

Every security primitive has a dedicated module in `security/`. The security audit (`pnpm audit:security`) validates all 20 vulnerability classes at runtime. See [security.md](security.md) for the full model.

### Plugin sandbox

Plugins run in `worker_threads` with Node.js 22+ permission model. They communicate via structured message passing and can only access resources they declare in their permission manifest.

## Common tasks

### Add a new gateway method

1. Create a handler in `gateway/server-methods/your-method.ts`
2. Define a Zod schema for the params
3. Export a `createYourMethodHandler()` factory function
4. Register it in `gateway/server.ts`
5. Export from `index.ts`
6. Write tests

### Add a new channel

1. Create `extensions/your-channel/` with `package.json` and `src/index.ts`
2. Implement `ChannelPlugin` interface (id, name, capabilities, start, stop, status, sendMessage)
3. Use `ChannelRuntime.onMessage` to deliver inbound messages
4. Wrap external content with `wrapExternalContent()` before passing to the agent
5. See [slack-setup.md](slack-setup.md) for a concrete example

### Run security audit

```bash
pnpm audit:security
# or
pnpm dev audit
# or with a specific root directory
pnpm dev audit --root /path/to/project
```
