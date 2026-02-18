# Security Model

Haya is a clean-room reimplementation of OpenClaw that fixes all 20 identified security vulnerabilities. This document describes the security model and each fix.

## Threat model

Haya is a personal AI assistant gateway that:
- Accepts WebSocket connections from clients
- Connects to external messaging services (Slack, etc.)
- Executes AI model requests
- Runs plugins in sandboxed environments
- Processes untrusted external content (messages, emails)

The primary threats are:
1. Unauthorized access to the gateway
2. Prompt injection via external content
3. Code execution through eval/shell injection
4. Secret leakage through logs, config files, or timing attacks
5. Plugin escape from sandbox

## Security audit

Run the built-in security audit to verify all 20 checks:

```bash
pnpm audit:security
```

This returns a structured `SecurityAuditReport` with pass/fail/warn status for each check.

## Vulnerability fixes

### Critical (3)

#### CRIT-1: No "none" auth mode

**Problem**: OpenClaw defaults to unauthenticated access when no token is configured.

**Fix**: The Zod schema only allows `"token" | "password"`. On first run with no config, a cryptographically random 64-hex token is generated, printed once, and persisted. The gateway refuses to start without valid authentication.

#### CRIT-2: No eval() or new Function()

**Problem**: OpenClaw uses `eval("(" + fnBody + ")")` on user-supplied code.

**Fix**: Zero `eval()` or `new Function()` in the codebase. The security audit statically checks all source files for these patterns.

#### CRIT-3: No shell injection

**Problem**: OpenClaw uses `execSync` with string interpolation and `shell: true`.

**Fix**: All command execution goes through `safeExecSync()` in `security/command-exec.ts`, which always uses `execFileSync` with `shell: false`. Arguments are passed as arrays, never interpolated into strings.

### High (7)

#### HIGH-1: Constant-time secret comparison

**Problem**: OpenClaw's `safeEqualSecret()` returns early on length mismatch, leaking token length.

**Fix**: Both inputs are hashed with SHA-256 to fixed 32-byte digests before `timingSafeEqual` comparison. Always runs on equal-length buffers.

#### HIGH-2: No prompt injection bypass

**Problem**: OpenClaw has `allowUnsafeExternalContent` flag that bypasses protection.

**Fix**: No bypass flag exists. `wrapExternalContent()` always applies boundary markers and suspicious pattern detection. There is no opt-out.

#### HIGH-3: No hardcoded secrets

**Problem**: Secrets could be stored as plaintext in config files or source code.

**Fix**: Config stores environment variable names (references), never actual values. Secrets are resolved at runtime via `resolveSecret()` from `process.env`.

#### HIGH-4: Strong TLS

**Problem**: OpenClaw auto-generates RSA-2048 certs with 10-year validity.

**Fix**: ECDSA P-384 with SHA-384, 90-day expiry, TLS 1.3 minimum. Auto-regenerate on expiry.

#### HIGH-5: Proxy-aware rate limiting

**Problem**: Rate limiting by raw socket IP breaks behind proxies.

**Fix**: Rate limiter uses resolved client IP (after trusted proxy validation). `X-Forwarded-For` only honored when the socket address matches a configured trusted proxy.

#### HIGH-6: Nonce-based CSP

**Problem**: OpenClaw uses `unsafe-inline` in CSP and allows unencrypted `ws:`.

**Fix**: Fresh random nonce per request. Only `wss:` allowed in connect-src.

#### HIGH-7: Sandboxed plugins

**Problem**: OpenClaw loads plugins in-process with only a regex scanner for dangerous patterns.

**Fix**: Plugins run in `worker_threads` with Node.js 22+ `--experimental-permission` flags. Filesystem, network, and process access restricted per plugin manifest.

### Medium (9)

| ID | Description | Fix |
|----|-------------|-----|
| MED-1 | Config validation | Zod schema with cross-field refinements |
| MED-2 | Secrets from env only | `resolveSecret()` reads `process.env`, never config file |
| MED-3 | Session isolation | Separate session store per session ID |
| MED-4 | No weak placeholder tokens | `.env.example` has empty values with generation instructions |
| MED-5 | `node:` prefix | All built-in imports use `node:` prefix |
| MED-6 | No wildcard CORS | No `Access-Control-Allow-Origin: *` |
| MED-7 | Structured errors | Error types never expose stack traces to clients |
| MED-8 | Logging redaction | tslog `maskValuesOfKeys` for sensitive fields |
| MED-9 | File permissions | Config and cron files written with `0o600` |

### Low (1)

#### LOW-7: No curl|bash in Dockerfile

**Problem**: OpenClaw uses `curl | bash` to install bun.

**Fix**: Uses `corepack enable` for pnpm. No remote scripts piped to bash. Non-root user (`haya`, UID 1000). Multi-stage build with frozen lockfile.
