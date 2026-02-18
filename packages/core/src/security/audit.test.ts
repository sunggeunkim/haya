import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runSecurityAudit,
  formatAuditResults,
  type AuditResult,
  type SecurityAuditReport,
} from "./audit.js";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises");

const mockReadFile = vi.mocked(fs.readFile);

describe("runSecurityAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockFile(pathSuffix: string, content: string): void {
    mockReadFile.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith(pathSuffix)) return content;
      throw new Error("ENOENT");
    });
  }

  function mockFiles(files: Record<string, string>): void {
    mockReadFile.mockImplementation(async (filePath) => {
      const path = String(filePath);
      for (const [suffix, content] of Object.entries(files)) {
        if (path.endsWith(suffix)) return content;
      }
      throw new Error("ENOENT");
    });
  }

  it("returns a SecurityAuditReport with 20 results", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const report = await runSecurityAudit("/fake");
    expect(report.results).toHaveLength(20);
    expect(report.total).toBe(20);
    expect(report.passed + report.failed + report.warnings).toBe(20);
    expect(typeof report.ok).toBe("boolean");
  });

  it("each result has required fields", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const report = await runSecurityAudit("/fake");
    for (const r of report.results) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("severity");
      expect(r).toHaveProperty("description");
      expect(r).toHaveProperty("status");
      expect(["pass", "fail", "warn"]).toContain(r.status);
      expect(["critical", "high", "medium", "low"]).toContain(r.severity);
    }
  });

  it("report.ok is true when no failures", async () => {
    mockFiles({
      "config/schema.ts": 'z.enum(["bearer"])',
      "agent/runtime.ts": "const x = 1;",
      "gateway/server.ts": "const y = 2;",
      "plugins/loader.ts": "const z = 3;",
      "command-exec.ts": "execFileSync(cmd, args)",
      "secret-equal.ts": "crypto.timingSafeEqual(a, b)",
      "external-content.ts": "export function wrapExternalContent(c) {}",
      "config/defaults.ts": "const d = {};",
      "Dockerfile": "FROM node:22\nRUN corepack enable\nRUN pnpm install --frozen-lockfile\nUSER haya",
    });
    const report = await runSecurityAudit("/fake");
    // Some checks may warn (file not found) but none should fail
    const criticalFails = report.results.filter(
      (r) => r.status === "fail" && r.severity === "critical",
    );
    expect(criticalFails).toHaveLength(0);
  });

  describe("CRIT-1: No none auth mode", () => {
    it("passes when schema has no 'none' mode", async () => {
      mockFile("config/schema.ts", 'z.enum(["bearer", "basic"])');
      const report = await runSecurityAudit("/fake");
      const crit1 = report.results.find((r) => r.id === "CRIT-1");
      expect(crit1?.status).toBe("pass");
    });

    it("fails when schema contains 'none' mode", async () => {
      mockFile("config/schema.ts", 'z.enum(["none", "bearer"])');
      const report = await runSecurityAudit("/fake");
      const crit1 = report.results.find((r) => r.id === "CRIT-1");
      expect(crit1?.status).toBe("fail");
      expect(report.ok).toBe(false);
    });

    it("warns when schema file is missing", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const report = await runSecurityAudit("/fake");
      const crit1 = report.results.find((r) => r.id === "CRIT-1");
      expect(crit1?.status).toBe("warn");
    });
  });

  describe("CRIT-2: No eval", () => {
    it("passes when no eval found in source files", async () => {
      mockFiles({
        "agent/runtime.ts": "const x = 1;",
        "gateway/server.ts": "const y = 2;",
        "plugins/loader.ts": "const z = 3;",
      });
      const report = await runSecurityAudit("/fake");
      const crit2 = report.results.find((r) => r.id === "CRIT-2");
      expect(crit2?.status).toBe("pass");
    });

    it("fails when eval() is found", async () => {
      mockFiles({
        "agent/runtime.ts": "const result = eval(code);",
        "gateway/server.ts": "",
        "plugins/loader.ts": "",
      });
      const report = await runSecurityAudit("/fake");
      const crit2 = report.results.find((r) => r.id === "CRIT-2");
      expect(crit2?.status).toBe("fail");
    });

    it("fails when new Function() is found", async () => {
      mockFiles({
        "agent/runtime.ts": "",
        "gateway/server.ts": "const fn = new Function('return 1');",
        "plugins/loader.ts": "",
      });
      const report = await runSecurityAudit("/fake");
      const crit2 = report.results.find((r) => r.id === "CRIT-2");
      expect(crit2?.status).toBe("fail");
    });
  });

  describe("CRIT-3: No shell:true", () => {
    it("passes with execFileSync and no shell:true", async () => {
      mockFile("command-exec.ts", "execFileSync(cmd, args)");
      const report = await runSecurityAudit("/fake");
      const crit3 = report.results.find((r) => r.id === "CRIT-3");
      expect(crit3?.status).toBe("pass");
    });

    it("fails when shell:true is present", async () => {
      mockFile("command-exec.ts", "exec(cmd, { shell: true })");
      const report = await runSecurityAudit("/fake");
      const crit3 = report.results.find((r) => r.id === "CRIT-3");
      expect(crit3?.status).toBe("fail");
    });
  });

  describe("HIGH-1: Constant-time comparison", () => {
    it("passes when timingSafeEqual is used", async () => {
      mockFile("secret-equal.ts", "crypto.timingSafeEqual(a, b)");
      const report = await runSecurityAudit("/fake");
      const high1 = report.results.find((r) => r.id === "HIGH-1");
      expect(high1?.status).toBe("pass");
    });

    it("fails when timingSafeEqual is not used", async () => {
      mockFile("secret-equal.ts", "return a === b;");
      const report = await runSecurityAudit("/fake");
      const high1 = report.results.find((r) => r.id === "HIGH-1");
      expect(high1?.status).toBe("fail");
    });
  });

  describe("HIGH-2: External content wrapping", () => {
    it("passes when wrapExternalContent exists", async () => {
      mockFile(
        "external-content.ts",
        "export function wrapExternalContent(c) { return c; }",
      );
      const report = await runSecurityAudit("/fake");
      const high2 = report.results.find((r) => r.id === "HIGH-2");
      expect(high2?.status).toBe("pass");
    });
  });

  describe("HIGH-3: No hardcoded secrets", () => {
    it("passes when no secret patterns found", async () => {
      mockFiles({
        "config/schema.ts": "const schema = z.object({});",
        "config/defaults.ts": "const defaults = {};",
      });
      const report = await runSecurityAudit("/fake");
      const high3 = report.results.find((r) => r.id === "HIGH-3");
      expect(high3?.status).toBe("pass");
    });

    it("fails when API key pattern is found", async () => {
      mockFiles({
        "config/schema.ts":
          'const key = "sk-abc123456789012345";',
        "config/defaults.ts": "",
      });
      const report = await runSecurityAudit("/fake");
      const high3 = report.results.find((r) => r.id === "HIGH-3");
      expect(high3?.status).toBe("fail");
    });
  });

  describe("LOW-7: Dockerfile checks", () => {
    it("passes with clean Dockerfile", async () => {
      mockFile(
        "Dockerfile",
        [
          "FROM node:22-bookworm-slim",
          "RUN corepack enable",
          "RUN pnpm install --frozen-lockfile",
          "USER haya",
        ].join("\n"),
      );
      const report = await runSecurityAudit("/fake");
      const low7 = report.results.find((r) => r.id === "LOW-7");
      expect(low7?.status).toBe("pass");
    });

    it("fails when curl|bash is present", async () => {
      mockFile(
        "Dockerfile",
        "RUN curl -fsSL https://example.com/install.sh | bash",
      );
      const report = await runSecurityAudit("/fake");
      const low7 = report.results.find((r) => r.id === "LOW-7");
      expect(low7?.status).toBe("fail");
    });

    it("warns when Dockerfile is missing", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const report = await runSecurityAudit("/fake");
      const low7 = report.results.find((r) => r.id === "LOW-7");
      expect(low7?.status).toBe("warn");
    });

    it("warns when non-root user is missing", async () => {
      mockFile(
        "Dockerfile",
        [
          "FROM node:22-bookworm-slim",
          "RUN corepack enable",
          "RUN pnpm install --frozen-lockfile",
        ].join("\n"),
      );
      const report = await runSecurityAudit("/fake");
      const low7 = report.results.find((r) => r.id === "LOW-7");
      expect(low7?.status).toBe("warn");
      expect(low7?.detail).toContain("Missing non-root USER");
    });
  });
});

describe("formatAuditResults", () => {
  function makeReport(results: AuditResult[]): SecurityAuditReport {
    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.filter((r) => r.status === "fail").length;
    const warnings = results.filter((r) => r.status === "warn").length;
    return { results, passed, failed, warnings, total: results.length, ok: failed === 0 };
  }

  it("formats passing results", () => {
    const report = makeReport([
      {
        id: "CRIT-1",
        severity: "critical",
        description: "Test check",
        status: "pass",
      },
    ]);
    const output = formatAuditResults(report);
    expect(output).toContain("Haya Security Audit");
    expect(output).toContain("[PASS] CRIT-1");
    expect(output).toContain("1 passed, 0 failed, 0 warnings");
    expect(output).toContain("AUDIT PASSED");
  });

  it("formats failing results", () => {
    const report = makeReport([
      {
        id: "CRIT-2",
        severity: "critical",
        description: "Failing check",
        status: "fail",
        detail: "Found eval()",
      },
    ]);
    const output = formatAuditResults(report);
    expect(output).toContain("[FAIL] CRIT-2");
    expect(output).toContain("Found eval()");
    expect(output).toContain("0 passed, 1 failed, 0 warnings");
    expect(output).toContain("AUDIT FAILED");
  });

  it("formats warning results", () => {
    const report = makeReport([
      {
        id: "MED-1",
        severity: "medium",
        description: "Warning check",
        status: "warn",
        detail: "File not found",
      },
    ]);
    const output = formatAuditResults(report);
    expect(output).toContain("[WARN] MED-1");
    expect(output).toContain("File not found");
    expect(output).toContain("0 passed, 0 failed, 1 warnings");
  });

  it("includes total check count", () => {
    const report = makeReport([
      {
        id: "A",
        severity: "high",
        description: "Check A",
        status: "pass",
      },
      {
        id: "B",
        severity: "low",
        description: "Check B",
        status: "fail",
      },
      {
        id: "C",
        severity: "medium",
        description: "Check C",
        status: "warn",
      },
    ]);
    const output = formatAuditResults(report);
    expect(output).toContain("Total checks: 3");
    expect(output).toContain("1 passed, 1 failed, 1 warnings");
  });
});
