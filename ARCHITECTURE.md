# Personal Assistant — Architecture & Security Design

## 1. Context

This project is a personal AI assistant gateway inspired by [OpenClaw](https://github.com/openclaw/openclaw). OpenClaw connects messaging channels (Telegram, Discord, Slack, WhatsApp, etc.) to AI models through a WebSocket control plane, with a plugin system, memory search, session management, and cron automation.

However, a security audit of OpenClaw identified **20 vulnerabilities** (3 critical, 7 high, 9 medium, 1 low). This project is a clean-room reimplementation that preserves the strong architectural patterns while systematically eliminating every vulnerability.

---

## 2. Architecture Overview

```
Messaging Channels (Telegram, Discord, Slack, etc.)
        |  (inbound messages via channel plugins)
        v
+-----------------------------------------------+
|           Gateway Server (WebSocket)           |
|  Port 18789 (configurable)                     |
|                                                |
|  Auth ........... MANDATORY (token | password) |
|  TLS ............ Required for non-loopback    |
|  Rate Limiting .. Proxy-aware, per-client-IP   |
|  CSP ............ Nonce-based, wss: only       |
|  Protocol ....... JSON-RPC, Zod-validated      |
+-----------------------------------------------+
        |
        +---> Agent Runtime ---> AI Provider APIs
        |       (OpenAI, Anthropic, Gemini, etc.)
        |
        +---> Session Manager ---> JSONL on disk
        |
        +---> Memory Manager ---> SQLite + sqlite-vec
        |       (hybrid BM25 + vector search)
        |
        +---> Cron Service ---> Scheduled automation
        |
        +---> Plugin Registry ---> Sandboxed worker_threads
```

### Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ |
| Language | TypeScript 5.9+ |
| Package Manager | pnpm 10 (monorepo) |
| HTTP Server | Express 5 |
| WebSocket | `ws` 8 |
| Schema Validation | Zod 4 |
| Database | SQLite (`node:sqlite`) + `sqlite-vec` |
| Scheduling | `croner` 10 |
| Logging | `tslog` 4 |
| CLI | `commander` 14 |
| Build | `tsdown` (rolldown-based) |
| Testing | Vitest 4 |

---

## 3. Project Structure

```
/home/sukim/dev/personal_assistant/
  package.json                     # Root workspace config
  pnpm-workspace.yaml
  tsconfig.json
  tsdown.config.ts
  vitest.config.ts
  Dockerfile                       # No curl|bash, non-root, frozen lockfile
  docker-compose.yml
  .env.example                     # Empty placeholders with generation instructions

  packages/
    core/                          # Main application
      package.json
      src/
        index.ts                   # Package entry
        entry.ts                   # CLI entry point

        config/
          schema.ts                # Zod schema (mandatory auth, env-only secrets)
          types.ts                 # Types derived from Zod
          loader.ts                # Config file I/O (0o600 permissions)
          defaults.ts
          secrets.ts               # Resolves secrets from env vars only
          validation.ts            # Cross-field validation

        gateway/
          server.ts                # Gateway bootstrap
          server-http.ts           # Express HTTP with security headers
          server-ws.ts             # WebSocket handler + protocol validation
          auth.ts                  # Authentication (token | password only)
          auth-rate-limit.ts       # Proxy-aware rate limiting
          net.ts                   # IP resolution with strict proxy trust
          tls.ts                   # ECDSA P-384, 90-day certs, TLSv1.3 min
          csp.ts                   # Nonce-based CSP, wss: only
          protocol/
            schema.ts              # Zod-validated protocol frames
            types.ts
            frames.ts
          server-methods/
            chat.ts
            config.ts
            sessions.ts
            channels.ts
            cron.ts

        security/
          secret-equal.ts          # Constant-time comparison (SHA-256 hash-padded)
          external-content.ts      # Mandatory prompt injection wrapping
          command-exec.ts          # Safe exec (execFileSync, shell:false always)
          plugin-sandbox.ts        # worker_threads with permission model
          audit.ts                 # Built-in security audit runner

        plugins/
          types.ts                 # Plugin API interface
          registry.ts
          loader.ts                # Sandboxed loading
          hooks.ts                 # Hook dispatch system

        memory/
          manager.ts               # MemoryIndexManager
          sqlite.ts                # SQLite wrapper
          sqlite-vec.ts            # Vector search extension
          hybrid.ts                # BM25 + vector merge
          embeddings.ts            # Embedding provider abstraction
          types.ts

        sessions/
          types.ts
          store.ts                 # JSONL persistence
          history.ts               # History management

        agent/
          runtime.ts               # Message -> AI -> response pipeline
          providers.ts             # AI provider abstraction
          tools.ts                 # Tool execution framework
          types.ts

        channels/
          types.ts                 # Channel plugin interface
          registry.ts
          dock.ts                  # Channel lifecycle (start/stop/status)

        cron/
          service.ts               # Cron scheduler
          store.ts                 # Job persistence

        infra/
          logger.ts                # Structured logging with sensitive data redaction
          errors.ts                # Error types

    plugin-sdk/                    # Published SDK for plugin authors
      package.json
      src/
        index.ts

  extensions/                      # Channel plugins (each a workspace package)
    telegram/
      package.json
      src/index.ts
```

---

## 4. Security Vulnerabilities in OpenClaw & Our Fixes

### 4.1 Summary

| Severity | Count | Status |
|---|---|---|
| CRITICAL | 3 | All fixed by design |
| HIGH | 7 | All fixed by design |
| MEDIUM | 9 | All fixed by design |
| LOW | 1 | Fixed |
| **Total** | **20** | **All addressed** |

---

### 4.2 Critical Vulnerabilities

#### CRIT-1: Gateway Defaults to Unauthenticated Access

**OpenClaw vulnerability:** When no token, password, or explicit auth mode is configured, the gateway runs in mode `"none"`. The Dockerfile runs with `--allow-unconfigured` and no `OPENCLAW_GATEWAY_TOKEN` set.

- `openclaw/src/gateway/auth.ts:191-198` — Falls through to `mode = "none"`
- `openclaw/Dockerfile:61` — `--allow-unconfigured` flag

**Our fix:** The `"none"` auth mode does not exist in the type system. The Zod schema only allows `"token" | "password"`, and the refinement requires a credential of minimum length. On first run with no config, the gateway generates a cryptographically random 64-hex token, prints it once, and persists it.

```typescript
// config/schema.ts
const GatewayAuthSchema = z.object({
  mode: z.enum(["token", "password"]),  // No "none"
  token: z.string().min(32).optional(),
  password: z.string().min(16).optional(),
}).refine(
  (auth) => {
    if (auth.mode === "token") return !!auth.token && auth.token.length >= 32;
    if (auth.mode === "password") return !!auth.password && auth.password.length >= 16;
    return false;
  },
  { message: "Auth credential required for selected mode" }
);
```

There is no `--allow-unconfigured` flag. The gateway refuses to start without valid authentication.

---

#### CRIT-2: `eval()` Used on User-Supplied Code

**OpenClaw vulnerability:** The browser automation tool uses `eval("(" + fnBody + ")")` on tool input parameters in the Node.js process.

- `openclaw/src/browser/pw-tools-core.interactions.ts:294,334`

**Our fix:** Zero `eval()` or `new Function()` anywhere in the codebase. For browser automation, we use Playwright's `page.evaluate()` which executes in the browser's sandbox. For any other sandboxed execution needs, we use `node:vm`'s `runInNewContext` with code generation disabled:

```typescript
// security/command-exec.ts
import { runInNewContext } from "node:vm";

export function executeSandboxedScript(
  code: string,
  context: Record<string, unknown>,
  timeoutMs = 5000,
): unknown {
  const sandbox = Object.create(null);
  Object.assign(sandbox, context);
  Object.freeze(sandbox);
  return runInNewContext(code, sandbox, {
    timeout: timeoutMs,
    contextCodeGeneration: { strings: false, wasm: false },
  });
}
```

---

#### CRIT-3: Shell Injection via `execSync` String Interpolation

**OpenClaw vulnerability:** `execSync(\`${cmd} ${binary}\`)` interpolates variables into a shell command string.

- `openclaw/src/daemon/program-args.ts:151-154`

**Our fix:** A single centralized module (`security/command-exec.ts`) is the only approved way to run external commands. It always uses `execFileSync(cmd, [args])` with `shell: false`:

```typescript
// security/command-exec.ts
export function safeExecSync(
  command: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
): string {
  return execFileSync(command, args, {
    ...options,
    shell: false,  // Explicit, always
    encoding: "utf-8",
  });
}
```

A lint rule flags any direct import of `child_process` outside this module.

---

### 4.3 High Vulnerabilities

#### HIGH-1: Timing Side-Channel in Secret Comparison

**OpenClaw vulnerability:** `safeEqualSecret()` returns early on length mismatch, leaking whether the token has the correct byte length.

- `openclaw/src/security/secret-equal.ts:12-15`

**Our fix:** Hash both inputs with SHA-256 to fixed 32-byte digests before comparison. `timingSafeEqual` always runs on equal-length buffers:

```typescript
// security/secret-equal.ts
export function safeEqualSecret(provided: string | null, expected: string | null): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}
```

---

#### HIGH-2: Auth Mode `"none"` Valid in Production

**OpenClaw vulnerability:** The gateway can run with `auth.mode === "none"` which rejects remote connections but allows all local connections without authentication.

- `openclaw/src/gateway/auth.ts:383-385`

**Our fix:** Same as CRIT-1. The type `"none"` does not exist in the schema.

---

#### HIGH-3: `allowUnsafeExternalContent` Disables Prompt Injection Protection

**OpenClaw vulnerability:** A config flag `allowUnsafeExternalContent` bypasses the `wrapExternalContent()` security boundary, allowing raw external content (emails, webhooks) to reach the LLM without prompt injection detection or boundary markers.

- `openclaw/src/cron/isolated-agent/run.ts:374-377`

**Our fix:** No bypass flag exists. The `wrapExternalContent()` function is the only pathway for external content and has no opt-out parameter. It always applies:
- Suspicious pattern detection
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Security warning blocks

---

#### HIGH-4: `shell: true` with Raw User Input

**OpenClaw vulnerability:** The TUI local shell feature spawns commands with `shell: true` and raw user input.

- `openclaw/src/tui/tui-local-shell.ts:112`

**Our fix:** Same as CRIT-3. All command execution goes through `safeExec`/`safeExecSync` which always sets `shell: false`. If a PTY shell is needed, use `node-pty` (a proper pseudoterminal), not `spawn({ shell: true })`.

---

#### HIGH-5: Weak TLS Certificates

**OpenClaw vulnerability:** Auto-generated self-signed certificates use RSA-2048 with 10-year validity.

- `openclaw/src/infra/tls/gateway.ts:44-58`

**Our fix:** ECDSA P-384 with SHA-384 and 90-day certificate expiry. Auto-regenerate on expiry. TLS 1.3 minimum enforced:

```typescript
// gateway/tls.ts
await safeExec("openssl", [
  "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-384",
  "-sha384", "-days", "90", "-nodes",
  "-keyout", keyPath, "-out", certPath,
  "-subj", "/CN=personal-assistant-gateway",
]);
// TLS options always include: minVersion: "TLSv1.3"
```

---

#### HIGH-6: Proxy Header Trust Without Enforced Configuration

**OpenClaw vulnerability:** `X-Forwarded-For` may be trusted without explicit proxy configuration, enabling IP spoofing and rate-limit bypass.

- `openclaw/src/gateway/auth.ts:68-70`
- `openclaw/src/gateway/net.ts:230-243`

**Our fix:** `X-Forwarded-For` is only honored when both conditions are met:
1. `gateway.trustedProxies` is explicitly configured (non-empty array)
2. The socket's remote address matches a listed proxy IP

If `trustedProxies` is empty or unset, forwarded headers are always ignored.

---

#### HIGH-7: Plugins Run Unsandboxed with Full System Access

**OpenClaw vulnerability:** Plugins are loaded in-process with `jiti`. A static regex scanner for dangerous patterns is easily bypassed (dynamic imports, obfuscation).

- `openclaw/src/plugins/loader.ts`
- `openclaw/src/security/skill-scanner.ts`

**Our fix:** Plugins run in `worker_threads` with Node.js 22+ permission model. Each plugin declares required permissions, and the sandbox restricts filesystem, network, and process access:

```typescript
// security/plugin-sandbox.ts
const worker = new Worker(pluginWorkerPath, {
  workerData: { pluginPath, pluginId, pluginConfig },
  execArgv: [
    "--experimental-permission",
    ...allowedPaths.map(p => `--allow-fs-read=${p}`),
    // No --allow-fs-write, no --allow-child-process by default
  ],
});
```

Plugins communicate with the host via structured message-passing over the worker's message port.

---

### 4.4 Medium Vulnerabilities

#### MED-1: `unsafe-inline` in CSP for Styles

**OpenClaw:** `style-src 'self' 'unsafe-inline'` in `openclaw/src/gateway/control-ui-csp.ts:10`

**Our fix:** Nonce-based CSP. A fresh random nonce is generated per request:

```typescript
// gateway/csp.ts
`style-src 'self' 'nonce-${generateCspNonce()}'`
```

---

#### MED-2: Unencrypted WebSocket (`ws:`) Allowed in CSP

**OpenClaw:** `connect-src 'self' ws: wss:` in `openclaw/src/gateway/control-ui-csp.ts:13`

**Our fix:** Only encrypted WebSocket: `connect-src 'self' wss:`

---

#### MED-3: Secrets Stored as Plaintext in Config

**OpenClaw:** API keys, bot tokens, and passwords are stored in `~/.openclaw/openclaw.json` as plaintext JSON. While file permissions are 0o600, secrets are exposed to backups, container volume mounts, and same-user processes.

- `openclaw/src/config/io.ts:1002-1004`

**Our fix:** The config file stores environment variable **names** (references), never actual secret values:

```typescript
// config/secrets.ts — secrets resolved at runtime from environment
const ModelProviderSchema = z.object({
  provider: z.string(),
  apiKeyEnvVar: z.string(),  // e.g., "OPENAI_API_KEY" — a reference
  // The actual key is NEVER stored in the config file
});

export function resolveSecret(envVarName: string): string | undefined {
  return process.env[envVarName];
}
```

---

#### MED-4: Known Weak Placeholder Token in `.env.example`

**OpenClaw:** `OPENCLAW_GATEWAY_TOKEN=change-me-to-a-long-random-token` in `.env.example:18`

**Our fix:** Empty value with clear generation instructions:

```bash
# .env.example
# REQUIRED: Generate with: openssl rand -hex 32
ASSISTANT_GATEWAY_TOKEN=
```

The gateway validates token entropy on startup and rejects known weak values.

---

#### MED-5: innerHTML XSS Risk

**OpenClaw:** Multiple `innerHTML` assignments with string concatenation in `openclaw/src/canvas-host/server.ts:113-117` and export templates.

**Our fix:** Lint rule bans `innerHTML`/`outerHTML` assignment. Use `textContent` for text, DOM APIs (`createElement`/`appendChild`) for structure.

---

#### MED-6: Rate Limiting by Raw Socket IP Only

**OpenClaw:** Hook auth rate limiting tracks by `req.socket.remoteAddress`, which is the proxy IP when behind NAT/LB.

- `openclaw/src/gateway/server-http.ts:202`

**Our fix:** Rate limiter uses the resolved client IP (after trusted proxy validation) plus per-identifier keys (e.g., username from auth attempt) to prevent distributed attacks and proxy-collapsed IPs.

---

#### MED-8: Pipe-Delimited Auth Payload Allows Field Injection

**OpenClaw:** Auth payload uses `fields.join("|")` without encoding field values, allowing a `|` in any field to inject additional fields.

- `openclaw/src/gateway/device-auth.ts:13-31`

**Our fix:** All auth payloads are structured JSON objects validated with Zod. No delimiter-based parsing anywhere.

---

#### MED-9: TLS Disabled by Default

**OpenClaw:** TLS is opt-in. Default gateway runs plaintext HTTP/WS even on LAN binds.

- `openclaw/src/infra/tls/gateway.ts:71-73`

**Our fix:** Config validation enforces: if `gateway.bind !== "loopback"`, then `gateway.tls.enabled` must be `true`. Startup fails with a clear error message if this rule is violated.

---

### 4.5 Low Vulnerabilities

#### LOW-7: `curl | bash` in Dockerfile

**OpenClaw:** `RUN curl -fsSL https://bun.sh/install | bash` in `Dockerfile:4`

**Our fix:** Use `corepack enable` for pnpm. No remote scripts piped to bash. All tool versions pinned in lockfile:

```dockerfile
FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
# ... frozen lockfile, non-root user
```

---

## 5. Key Interfaces

### Config Schema (Zod-first)

```typescript
// config/schema.ts
export const AssistantConfigSchema = z.object({
  gateway: z.object({
    port: z.number().int().min(1).max(65535).default(18789),
    bind: z.enum(["loopback", "lan", "custom"]).default("loopback"),
    auth: GatewayAuthSchema,           // Mandatory, no "none"
    tls: GatewayTlsSchema.optional(),
    trustedProxies: z.array(z.string()).default([]),
  }),
  agent: z.object({
    defaultModel: z.string().default("gpt-4o"),
    defaultProviderApiKeyEnvVar: z.string(),
    systemPrompt: z.string().optional(),
    maxHistoryMessages: z.number().int().min(0).default(100),
  }),
  memory: MemorySchema.optional(),
  cron: z.array(CronJobSchema).default([]),
  plugins: z.array(z.string()).default([]),
  logging: LoggingSchema.optional(),
});
```

### Plugin API

```typescript
// plugins/types.ts
export type PluginDefinition = {
  id: string;
  name: string;
  version?: string;
  permissions?: {
    fileSystemRead?: string[];
    fileSystemWrite?: string[];
    network?: boolean;
  };
  register: (api: PluginApi) => void | Promise<void>;
};

export type PluginApi = {
  registerTool: (tool: AgentTool) => void;
  registerChannel: (channel: ChannelPlugin) => void;
  registerHook: (event: string, handler: HookHandler) => void;
  registerHttpRoute: (params: { path: string; handler: HttpHandler }) => void;
  logger: PluginLogger;
};
```

### Gateway Protocol

```typescript
// gateway/protocol/types.ts
export type GatewayRequest = {
  id: string;       // UUID for correlation
  method: string;   // e.g., "chat.send", "sessions.list"
  params?: Record<string, unknown>;
};

export type GatewayResponse = {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
};

export type GatewayEvent = {
  event: string;    // e.g., "chat.chunk", "channel.status"
  data: unknown;
};
```

### Memory Search

```typescript
// memory/types.ts
export interface MemorySearchManager {
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
  index(content: string, source: string, metadata?: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
}
```

---

## 6. Implementation Phases

### Phase 1: Foundation
Config system, security primitives, project scaffolding.

- Root workspace files (`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, etc.)
- `config/` — Zod schema, types, loader, secrets, validation
- `security/secret-equal.ts` — Hash-padded constant-time comparison
- `security/command-exec.ts` — Safe exec wrappers
- `security/external-content.ts` — Mandatory prompt injection wrapping
- `infra/logger.ts` — Structured logging with redaction
- Tests for all modules

### Phase 2: Gateway Core
Server, auth, WebSocket, TLS, CSP, rate limiting.

- `gateway/net.ts`, `auth.ts`, `auth-rate-limit.ts`, `tls.ts`, `csp.ts`
- `gateway/server.ts`, `server-http.ts`, `server-ws.ts`
- `gateway/protocol/` — Zod-validated frames
- E2E auth flow tests

### Phase 3: Agent Runtime & Sessions
AI integration, tool execution, session management.

- `agent/providers.ts`, `runtime.ts`, `tools.ts`
- `sessions/store.ts`, `history.ts`
- `gateway/server-methods/chat.ts`, `sessions.ts`

### Phase 4: Memory System
SQLite + sqlite-vec hybrid search.

- `memory/sqlite.ts`, `sqlite-vec.ts`, `embeddings.ts`, `hybrid.ts`, `manager.ts`

### Phase 5: Plugin System
Sandboxed plugins via worker_threads.

- `security/plugin-sandbox.ts`
- `plugins/types.ts`, `registry.ts`, `loader.ts`, `hooks.ts`
- `packages/plugin-sdk/`

### Phase 6: Channels, Cron, Production
Channel framework, cron, Docker, CI, first channel plugin.

- `channels/types.ts`, `registry.ts`, `dock.ts`
- `cron/service.ts`, `store.ts`
- `extensions/telegram/`
- `Dockerfile`, `docker-compose.yml`, `.env.example`

---

## 7. Verification Plan

| Method | What it validates |
|---|---|
| Unit tests | Every security module: `secret-equal`, `command-exec`, `auth`, `external-content` |
| E2E tests | Gateway auth flow: reject unauthed, accept valid token, rate limit after failures, TLS handshake |
| Security audit command | `pnpm assistant audit` checks all 20 vulnerability classes at runtime |
| Manual smoke test | Start gateway, connect via WS with token, send chat, verify AI response |
| Docker test | Build image, verify auth required, no curl\|bash in layers |

---

## 8. Dependencies

### Production
```
express@^5  ws@^8  zod@^4  sqlite-vec  croner@^10
dotenv@^17  tslog@^4  commander@^14  undici@^7
```

### Development
```
typescript@^5.9  tsdown  vitest@^4  @vitest/coverage-v8
@types/node  @types/express  @types/ws  tsx  oxlint  oxfmt
```
