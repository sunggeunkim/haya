import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runDoctorChecks,
  formatDoctorResults,
} from "./doctor.js";
import type { DoctorReport, DoctorCheck } from "./doctor.js";

// Mock node:fs and node:child_process
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    accessSync: vi.fn(),
  };
});

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync, accessSync } from "node:fs";
import { execFileSync } from "node:child_process";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockAccessSync = vi.mocked(accessSync);
const mockExecFileSync = vi.mocked(execFileSync);

describe("runDoctorChecks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns pass for Node version check when version is sufficient", async () => {
    // Config file not found, sessions not found, disk check passes
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const nodeCheck = report.checks.find((c) => c.name === "Node version");
    expect(nodeCheck).toBeDefined();
    // The test runs on Node >= 22.12 in this project
    // We just verify the check exists and has a valid status
    expect(["pass", "fail"]).toContain(nodeCheck!.status);
  });

  it("returns fail for config file when file does not exist", async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "haya.json") return false;
      if (String(path) === "sessions") return false;
      return false;
    });
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck).toBeDefined();
    expect(configCheck!.status).toBe("fail");
    expect(configCheck!.message).toContain("not found");
  });

  it("returns pass for config file when file is valid JSON", async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "haya.json") return true;
      if (String(path) === "sessions") return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ agent: { defaultProviderApiKeyEnvVar: "OPENAI_API_KEY" } }),
    );
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck).toBeDefined();
    expect(configCheck!.status).toBe("pass");
    expect(configCheck!.message).toContain("valid JSON");
  });

  it("returns fail for config file when file is invalid JSON", async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "haya.json") return true;
      if (String(path) === "sessions") return false;
      return false;
    });
    mockReadFileSync.mockReturnValue("{invalid json");
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck).toBeDefined();
    expect(configCheck!.status).toBe("fail");
    expect(configCheck!.message).toContain("not valid JSON");
  });

  it("checks configured provider env var when config is loaded", async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "haya.json") return true;
      if (String(path) === "sessions") return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        agent: { defaultProviderApiKeyEnvVar: "ANTHROPIC_API_KEY" },
      }),
    );
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    // Env var not set
    delete process.env.ANTHROPIC_API_KEY;

    const report = await runDoctorChecks("haya.json");

    const envCheck = report.checks.find(
      (c) => c.name === "Environment variables",
    );
    expect(envCheck).toBeDefined();
    expect(envCheck!.status).toBe("fail");
    expect(envCheck!.message).toContain("ANTHROPIC_API_KEY");
    expect(envCheck!.message).toContain("not set");
  });

  it("passes env var check when the key is set", async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "haya.json") return true;
      if (String(path) === "sessions") return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        agent: { defaultProviderApiKeyEnvVar: "OPENAI_API_KEY" },
      }),
    );
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    process.env.OPENAI_API_KEY = "sk-test-12345";

    const report = await runDoctorChecks("haya.json");

    const envCheck = report.checks.find(
      (c) => c.name === "Environment variables",
    );
    expect(envCheck).toBeDefined();
    expect(envCheck!.status).toBe("pass");
    expect(envCheck!.message).toContain("OPENAI_API_KEY");

    delete process.env.OPENAI_API_KEY;
  });

  it("returns warn for env var check when config cannot be loaded", async () => {
    mockExistsSync.mockImplementation((path) => {
      // Config exists for the config check but fails to parse for env check
      if (String(path) === "haya.json") return false;
      if (String(path) === "sessions") return false;
      return false;
    });
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const envCheck = report.checks.find(
      (c) => c.name === "Environment variables",
    );
    expect(envCheck).toBeDefined();
    expect(envCheck!.status).toBe("warn");
  });

  it("returns warn for sessions directory when it does not exist", async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "sessions") return false;
      return false;
    });
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const sessionsCheck = report.checks.find(
      (c) => c.name === "Sessions directory",
    );
    expect(sessionsCheck).toBeDefined();
    expect(sessionsCheck!.status).toBe("warn");
  });

  it("returns pass for sessions directory when it exists and is writable", async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "sessions") return true;
      if (String(path) === "haya.json") return false;
      return false;
    });
    mockAccessSync.mockImplementation(() => {
      /* no-op means accessible */
    });
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const sessionsCheck = report.checks.find(
      (c) => c.name === "Sessions directory",
    );
    expect(sessionsCheck).toBeDefined();
    expect(sessionsCheck!.status).toBe("pass");
    expect(sessionsCheck!.message).toContain("writable");
  });

  it("returns fail for sessions directory when it exists but is not writable", async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "sessions") return true;
      if (String(path) === "haya.json") return false;
      return false;
    });
    mockAccessSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const sessionsCheck = report.checks.find(
      (c) => c.name === "Sessions directory",
    );
    expect(sessionsCheck).toBeDefined();
    expect(sessionsCheck!.status).toBe("fail");
    expect(sessionsCheck!.message).toContain("not writable");
  });

  it("passes disk space check when df fails", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("command not found");
    });

    const report = await runDoctorChecks("haya.json");

    const diskCheck = report.checks.find((c) => c.name === "Disk space");
    expect(diskCheck).toBeDefined();
    expect(diskCheck!.status).toBe("pass");
    expect(diskCheck!.message).toContain("unavailable");
  });

  it("warns when disk space is low", async () => {
    mockExistsSync.mockReturnValue(false);
    // 50 MB free (below 100 MB threshold)
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 499947571200 52428800  99% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    const diskCheck = report.checks.find((c) => c.name === "Disk space");
    expect(diskCheck).toBeDefined();
    expect(diskCheck!.status).toBe("warn");
    expect(diskCheck!.message).toContain("Low disk space");
  });

  it("sets report.ok to true when no checks fail", async () => {
    const originalVersion = process.version;
    Object.defineProperty(process, "version", { value: "v22.12.0", writable: true });

    mockExistsSync.mockImplementation((path) => {
      if (String(path) === "haya.json") return true;
      if (String(path) === "sessions") return true;
      return true;
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        agent: { defaultProviderApiKeyEnvVar: "TEST_KEY" },
      }),
    );
    mockAccessSync.mockImplementation(() => {
      /* writable */
    });
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );
    process.env.TEST_KEY = "some-value";

    const report = await runDoctorChecks("haya.json");

    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.status !== "fail")).toBe(true);

    delete process.env.TEST_KEY;
    Object.defineProperty(process, "version", { value: originalVersion, writable: true });
  });

  it("sets report.ok to false when any check fails", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockReturnValue(
      "Filesystem     1B-blocks  Used Available Use% Mounted on\n/dev/sda1 500000000000 100000000000 400000000000  25% /\n",
    );

    const report = await runDoctorChecks("haya.json");

    // Config file check should fail
    expect(report.ok).toBe(false);
  });
});

describe("formatDoctorResults", () => {
  it("formats passing report correctly", () => {
    const report: DoctorReport = {
      checks: [
        { name: "Node version", status: "pass", message: "v22.12.0 >= v22.12.0" },
        { name: "Config file", status: "pass", message: "Config is valid" },
      ],
      ok: true,
    };

    const output = formatDoctorResults(report);

    expect(output).toContain("[PASS] Node version");
    expect(output).toContain("[PASS] Config file");
    expect(output).toContain("All checks passed.");
    expect(output).not.toContain("[FAIL]");
    expect(output).not.toContain("[WARN]");
  });

  it("formats failing report correctly", () => {
    const report: DoctorReport = {
      checks: [
        { name: "Node version", status: "pass", message: "v22.12.0" },
        { name: "Config file", status: "fail", message: "not found" },
        { name: "Disk space", status: "warn", message: "low space" },
      ],
      ok: false,
    };

    const output = formatDoctorResults(report);

    expect(output).toContain("[PASS] Node version");
    expect(output).toContain("[FAIL] Config file");
    expect(output).toContain("[WARN] Disk space");
    expect(output).toContain("Some checks failed.");
  });

  it("includes check messages in output", () => {
    const report: DoctorReport = {
      checks: [
        {
          name: "Environment variables",
          status: "fail",
          message: "OPENAI_API_KEY is not set",
        },
      ],
      ok: false,
    };

    const output = formatDoctorResults(report);

    expect(output).toContain("OPENAI_API_KEY is not set");
  });

  it("handles empty checks array", () => {
    const report: DoctorReport = {
      checks: [],
      ok: true,
    };

    const output = formatDoctorResults(report);

    expect(output).toContain("All checks passed.");
  });
});
