# Security Policy

## Deployment Assumptions

Haya is designed as a **single-user, self-hosted** AI assistant gateway. It assumes:

- The host machine is trusted and under the operator's control.
- Only one user (the operator) interacts with the gateway.
- Network exposure is intentionally limited; public-facing deployments require additional hardening.

## Authentication

Authentication is **mandatory** in Haya. Every deployment must configure at least one of:

- **Token authentication**: A shared secret token passed via the `Authorization` header.
- **Password authentication**: A password verified against a stored bcrypt hash.

Unauthenticated requests are rejected with `401 Unauthorized`. There is no anonymous access mode.

## TLS Enforcement

For any non-loopback binding (i.e., not `127.0.0.1` or `::1`), Haya **enforces TLS**:

- Minimum protocol version: TLS 1.3.
- ECDSA P-384 certificates (auto-generated with 90-day rotation if not provided).
- The server will refuse to start on a non-loopback address without TLS configuration.

Loopback bindings are permitted without TLS for local development.

## Plugin Sandbox Model

Plugins run in isolated `worker_threads` with Node.js 22+ permission model restrictions:

- **File system**: Scoped to the plugin's own directory (read-only) and a dedicated data directory (read-write).
- **Network**: No outbound network access by default; must be explicitly granted.
- **No access** to the parent process environment variables, main thread memory, or other plugins.

Plugins communicate with the host exclusively through structured message passing.

## Direct Message Security

Channel integrations support **sender authentication** with configurable modes:

- **`open`**: Any sender can interact (suitable for private channels).
- **`allowlist`**: Only pre-approved sender IDs are accepted.
- **`token`**: Senders must include a verification token in their first message.

The default mode depends on the channel type. Operators should review sender auth configuration for any channel exposed to untrusted users.

## Vulnerability Reporting

If you discover a security vulnerability in Haya, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Use [GitHub Security Advisories](https://github.com/sukim/haya/security/advisories/new) to report the vulnerability privately.
3. Include:
   - A description of the vulnerability.
   - Steps to reproduce.
   - The potential impact.
   - Any suggested fix (optional).

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Running the Security Audit

Haya includes a built-in 20-check security audit suite. To run it:

```bash
pnpm dev audit
```

This checks for:

- Authentication configuration
- TLS certificate validity and protocol version
- Rate limiting configuration
- CSP header correctness
- Plugin sandbox permissions
- Session file permissions
- Environment variable exposure
- And more

Review the audit output and address any findings before deploying to a network-accessible address.
