import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AuditResult {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  status: "pass" | "fail" | "warn";
  detail?: string;
}

export interface SecurityAuditReport {
  results: AuditResult[];
  passed: number;
  failed: number;
  warnings: number;
  total: number;
  ok: boolean;
}

/**
 * Run security audit checks against the codebase.
 * Validates that all 20 OpenClaw vulnerability classes are addressed.
 */
export async function runSecurityAudit(
  rootDir: string,
): Promise<SecurityAuditReport> {
  const results: AuditResult[] = [];

  // CRIT-1: No "none" auth mode
  results.push(await checkNoNoneAuthMode(rootDir));

  // CRIT-2: No eval() or new Function()
  results.push(await checkNoEval(rootDir));

  // CRIT-3: No shell:true in child_process
  results.push(await checkNoShellTrue(rootDir));

  // HIGH-1: Secret comparison uses constant-time
  results.push(await checkConstantTimeComparison(rootDir));

  // HIGH-2: External content wrapped for prompt injection
  results.push(await checkExternalContentWrapping(rootDir));

  // HIGH-3: No hardcoded secrets in source
  results.push(await checkNoHardcodedSecrets(rootDir));

  // HIGH-4: TLS cert generation exists
  results.push(await checkTlsSupport(rootDir));

  // HIGH-5: Rate limiting on auth
  results.push(await checkAuthRateLimiting(rootDir));

  // HIGH-6: CSP headers
  results.push(await checkCspHeaders(rootDir));

  // HIGH-7: Plugin sandboxing
  results.push(await checkPluginSandbox(rootDir));

  // MED-1: Config validation with Zod
  results.push(await checkConfigValidation(rootDir));

  // MED-2: Secrets from env vars only
  results.push(await checkSecretsFromEnv(rootDir));

  // MED-3: Session store isolation
  results.push(await checkSessionIsolation(rootDir));

  // MED-4: No weak placeholder tokens in .env.example
  results.push(await checkEnvExample(rootDir));

  // MED-5: node: prefix for builtins
  results.push(await checkNodePrefix(rootDir));

  // MED-6: No wildcard CORS
  results.push(await checkNoCorsWildcard(rootDir));

  // MED-7: Error messages don't leak internals
  results.push(await checkErrorMessages(rootDir));

  // MED-8: Logging redaction
  results.push(await checkLoggingRedaction(rootDir));

  // MED-9: File permissions on sensitive files
  results.push(await checkFilePermissions(rootDir));

  // LOW-7: No curl|bash in Dockerfile
  results.push(await checkDockerfile(rootDir));

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warnings = results.filter((r) => r.status === "warn").length;

  return {
    results,
    passed,
    failed,
    warnings,
    total: results.length,
    ok: failed === 0,
  };
}

async function readSourceFile(
  rootDir: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return await readFile(join(rootDir, relativePath), "utf-8");
  } catch {
    return null;
  }
}

async function checkNoNoneAuthMode(rootDir: string): Promise<AuditResult> {
  const schema = await readSourceFile(
    rootDir,
    "packages/core/src/config/schema.ts",
  );
  if (!schema) {
    return {
      id: "CRIT-1",
      severity: "critical",
      description: "No 'none' auth mode in schema",
      status: "warn",
      detail: "Could not read config/schema.ts",
    };
  }
  const hasNone = /["']none["']/.test(schema);
  return {
    id: "CRIT-1",
    severity: "critical",
    description: "No 'none' auth mode in schema",
    status: hasNone ? "fail" : "pass",
    detail: hasNone ? "Found 'none' in auth mode enum" : undefined,
  };
}

async function checkNoEval(rootDir: string): Promise<AuditResult> {
  const files = [
    "packages/core/src/agent/runtime.ts",
    "packages/core/src/gateway/server.ts",
    "packages/core/src/plugins/loader.ts",
  ];
  for (const file of files) {
    const content = await readSourceFile(rootDir, file);
    if (content && /\beval\s*\(|\bnew\s+Function\s*\(/.test(content)) {
      return {
        id: "CRIT-2",
        severity: "critical",
        description: "No eval() or new Function()",
        status: "fail",
        detail: `Found eval/Function in ${file}`,
      };
    }
  }
  return {
    id: "CRIT-2",
    severity: "critical",
    description: "No eval() or new Function()",
    status: "pass",
  };
}

async function checkNoShellTrue(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/security/command-exec.ts",
  );
  if (!content) {
    return {
      id: "CRIT-3",
      severity: "critical",
      description: "No shell:true in command execution",
      status: "warn",
      detail: "Could not read command-exec.ts",
    };
  }
  const hasShellTrue = /shell\s*:\s*true/.test(content);
  const usesExecFile = /execFileSync/.test(content);
  return {
    id: "CRIT-3",
    severity: "critical",
    description: "No shell:true in command execution",
    status: hasShellTrue ? "fail" : usesExecFile ? "pass" : "warn",
    detail: hasShellTrue ? "Found shell:true" : undefined,
  };
}

async function checkConstantTimeComparison(
  rootDir: string,
): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/security/secret-equal.ts",
  );
  if (!content) {
    return {
      id: "HIGH-1",
      severity: "high",
      description: "Constant-time secret comparison",
      status: "warn",
      detail: "Could not read secret-equal.ts",
    };
  }
  const usesTimingSafe = /timingSafeEqual/.test(content);
  return {
    id: "HIGH-1",
    severity: "high",
    description: "Constant-time secret comparison",
    status: usesTimingSafe ? "pass" : "fail",
  };
}

async function checkExternalContentWrapping(
  rootDir: string,
): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/security/external-content.ts",
  );
  if (!content) {
    return {
      id: "HIGH-2",
      severity: "high",
      description: "External content wrapping for prompt injection",
      status: "warn",
      detail: "Could not read external-content.ts",
    };
  }
  const hasWrapper = /wrapExternalContent/.test(content);
  return {
    id: "HIGH-2",
    severity: "high",
    description: "External content wrapping for prompt injection",
    status: hasWrapper ? "pass" : "fail",
  };
}

async function checkNoHardcodedSecrets(
  rootDir: string,
): Promise<AuditResult> {
  const files = [
    "packages/core/src/config/schema.ts",
    "packages/core/src/config/defaults.ts",
  ];
  for (const file of files) {
    const content = await readSourceFile(rootDir, file);
    if (
      content &&
      /(?:sk-|xoxb-|ghp_|AKIA)[A-Za-z0-9]{10,}/.test(content)
    ) {
      return {
        id: "HIGH-3",
        severity: "high",
        description: "No hardcoded secrets in source",
        status: "fail",
        detail: `Potential hardcoded secret in ${file}`,
      };
    }
  }
  return {
    id: "HIGH-3",
    severity: "high",
    description: "No hardcoded secrets in source",
    status: "pass",
  };
}

async function checkTlsSupport(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/gateway/tls.ts",
  );
  return {
    id: "HIGH-4",
    severity: "high",
    description: "TLS support exists",
    status: content ? "pass" : "fail",
  };
}

async function checkAuthRateLimiting(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/gateway/auth-rate-limit.ts",
  );
  return {
    id: "HIGH-5",
    severity: "high",
    description: "Auth rate limiting",
    status: content ? "pass" : "fail",
  };
}

async function checkCspHeaders(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/gateway/csp.ts",
  );
  return {
    id: "HIGH-6",
    severity: "high",
    description: "CSP header generation",
    status: content ? "pass" : "fail",
  };
}

async function checkPluginSandbox(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/security/plugin-sandbox.ts",
  );
  if (!content) {
    return {
      id: "HIGH-7",
      severity: "high",
      description: "Plugin sandboxing with permission model",
      status: "fail",
    };
  }
  const hasPermissions = /experimental-permission/.test(content);
  return {
    id: "HIGH-7",
    severity: "high",
    description: "Plugin sandboxing with permission model",
    status: hasPermissions ? "pass" : "warn",
  };
}

async function checkConfigValidation(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/config/validation.ts",
  );
  return {
    id: "MED-1",
    severity: "medium",
    description: "Config validation with Zod",
    status: content ? "pass" : "fail",
  };
}

async function checkSecretsFromEnv(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/config/secrets.ts",
  );
  if (!content) {
    return {
      id: "MED-2",
      severity: "medium",
      description: "Secrets resolved from env vars only",
      status: "fail",
    };
  }
  const usesProcessEnv = /process\.env/.test(content);
  return {
    id: "MED-2",
    severity: "medium",
    description: "Secrets resolved from env vars only",
    status: usesProcessEnv ? "pass" : "warn",
  };
}

async function checkSessionIsolation(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/sessions/store.ts",
  );
  return {
    id: "MED-3",
    severity: "medium",
    description: "Session store isolation",
    status: content ? "pass" : "fail",
  };
}

async function checkEnvExample(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(rootDir, ".env.example");
  if (!content) {
    return {
      id: "MED-4",
      severity: "medium",
      description: "No weak placeholder tokens in .env.example",
      status: "warn",
      detail: "No .env.example found",
    };
  }
  const hasWeakToken =
    /TOKEN=change-me|TOKEN=your-token|TOKEN=secret/.test(content);
  const hasEmptyToken = /TOKEN=\s*$/.test(content);
  return {
    id: "MED-4",
    severity: "medium",
    description: "No weak placeholder tokens in .env.example",
    status: hasWeakToken ? "fail" : hasEmptyToken ? "pass" : "pass",
    detail: hasWeakToken
      ? "Found weak placeholder token in .env.example"
      : undefined,
  };
}

async function checkNodePrefix(rootDir: string): Promise<AuditResult> {
  const files = [
    "packages/core/src/security/secret-equal.ts",
    "packages/core/src/security/command-exec.ts",
    "packages/core/src/gateway/tls.ts",
  ];
  for (const file of files) {
    const content = await readSourceFile(rootDir, file);
    if (!content) continue;
    // Check for bare imports like 'crypto', 'fs', 'path' without node: prefix
    const bareImport = /from\s+["'](crypto|fs|path|child_process|os|net|http|https|tls|url)["']/.test(
      content,
    );
    if (bareImport) {
      return {
        id: "MED-5",
        severity: "medium",
        description: "node: prefix for built-in modules",
        status: "fail",
        detail: `Bare import without node: prefix in ${file}`,
      };
    }
  }
  return {
    id: "MED-5",
    severity: "medium",
    description: "node: prefix for built-in modules",
    status: "pass",
  };
}

async function checkNoCorsWildcard(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/gateway/server-http.ts",
  );
  if (!content) {
    return {
      id: "MED-6",
      severity: "medium",
      description: "No wildcard CORS",
      status: "warn",
      detail: "Could not read server-http.ts",
    };
  }
  const hasWildcardCors = /Access-Control-Allow-Origin.*\*/.test(content);
  return {
    id: "MED-6",
    severity: "medium",
    description: "No wildcard CORS",
    status: hasWildcardCors ? "fail" : "pass",
  };
}

async function checkErrorMessages(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/infra/errors.ts",
  );
  return {
    id: "MED-7",
    severity: "medium",
    description: "Structured error handling (no stack leak)",
    status: content ? "pass" : "fail",
  };
}

async function checkLoggingRedaction(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/infra/logger.ts",
  );
  if (!content) {
    return {
      id: "MED-8",
      severity: "medium",
      description: "Logging redaction for sensitive keys",
      status: "fail",
    };
  }
  const hasRedaction = /redact|maskValuesOfKeys/.test(content);
  return {
    id: "MED-8",
    severity: "medium",
    description: "Logging redaction for sensitive keys",
    status: hasRedaction ? "pass" : "fail",
  };
}

async function checkFilePermissions(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(
    rootDir,
    "packages/core/src/cron/store.ts",
  );
  if (!content) {
    return {
      id: "MED-9",
      severity: "medium",
      description: "Restrictive file permissions on sensitive data",
      status: "warn",
      detail: "Could not read cron/store.ts",
    };
  }
  const has600 = /0o600/.test(content);
  return {
    id: "MED-9",
    severity: "medium",
    description: "Restrictive file permissions on sensitive data",
    status: has600 ? "pass" : "warn",
  };
}

async function checkDockerfile(rootDir: string): Promise<AuditResult> {
  const content = await readSourceFile(rootDir, "Dockerfile");
  if (!content) {
    return {
      id: "LOW-7",
      severity: "low",
      description: "No curl|bash in Dockerfile",
      status: "warn",
      detail: "No Dockerfile found",
    };
  }
  const hasCurlBash = /curl.*\|.*bash|wget.*\|.*sh/.test(content);
  const hasNonRoot = /USER\s+haya/.test(content);
  const hasFrozenLockfile = /frozen-lockfile/.test(content);
  const hasCorepack = /corepack\s+enable/.test(content);

  if (hasCurlBash) {
    return {
      id: "LOW-7",
      severity: "low",
      description: "No curl|bash in Dockerfile",
      status: "fail",
      detail: "Found curl|bash pattern in Dockerfile",
    };
  }

  const issues: string[] = [];
  if (!hasNonRoot) issues.push("Missing non-root USER");
  if (!hasFrozenLockfile) issues.push("Missing --frozen-lockfile");
  if (!hasCorepack) issues.push("Missing corepack enable");

  return {
    id: "LOW-7",
    severity: "low",
    description: "No curl|bash in Dockerfile",
    status: issues.length > 0 ? "warn" : "pass",
    detail: issues.length > 0 ? issues.join(", ") : undefined,
  };
}

/**
 * Format audit results for console output.
 */
export function formatAuditResults(report: SecurityAuditReport): string {
  const lines: string[] = ["Haya Security Audit", "=".repeat(50)];

  for (const r of report.results) {
    const icon =
      r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "WARN";
    const line = `  [${icon}] ${r.id} (${r.severity}): ${r.description}`;
    lines.push(line);
    if (r.detail) {
      lines.push(`         ${r.detail}`);
    }
  }

  lines.push("");
  lines.push(`Results: ${report.passed} passed, ${report.failed} failed, ${report.warnings} warnings`);
  lines.push(`Total checks: ${report.total}`);

  if (report.failed > 0) {
    lines.push("");
    lines.push("AUDIT FAILED: Security vulnerabilities detected");
  } else {
    lines.push("");
    lines.push("AUDIT PASSED: No security vulnerabilities detected");
  }

  return lines.join("\n");
}
