# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-02-21

### Added
- Initial release of Haya personal AI assistant gateway
- Core gateway with WebSocket and HTTP APIs (Express 5)
- AI provider support: OpenAI, Anthropic, AWS Bedrock, and OpenAI-compatible APIs
- Provider fallback chain with model-pattern routing
- Streaming support for OpenAI and Anthropic providers
- Retry with exponential backoff for transient provider errors
- Channel integrations: Slack, Discord, Telegram, Teams, WhatsApp, Signal, IRC, Google Chat, Webhook
- Zod-first configuration with mandatory authentication
- TLS with ECDSA P-384, 90-day certs, TLS 1.3 minimum
- Proxy-aware rate limiting
- Nonce-based CSP with wss: only
- Sandboxed plugins via worker_threads with Node.js 22+ permissions
- Memory system with BM25 + vector hybrid search (native node:sqlite + sqlite-vec)
- Session management with JSONL persistence, pruning, and usage budgets
- Cron job scheduling
- Security audit (20-check suite)
- Tool policy engine (allow/confirm/deny)
- Google Calendar, Gmail, and Drive tools with shared OAuth2
- Google Maps tools
- CLI: init, start, doctor, onboard, audit, usage, channels, cron, senders, config, google
- Docker multi-stage build with non-root user and health checks
- OpenTelemetry observability support
