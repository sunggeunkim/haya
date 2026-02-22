import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { createLogger } from "../infra/logger.js";

const log = createLogger("doctor");

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

/**
 * Minimum required Node.js version (major.minor).
 */
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 12;

/**
 * Minimum free disk space in bytes (100 MB).
 */
const MIN_DISK_SPACE_BYTES = 100 * 1024 * 1024;

/**
 * Run all doctor diagnostic checks and return a report.
 */
export async function runDoctorChecks(
  configPath?: string,
): Promise<DoctorReport> {
  const resolvedConfigPath = configPath ?? "haya.json";
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());
  checks.push(checkConfigFile(resolvedConfigPath));

  // Load config to determine provider key env var
  const configData = loadConfigSafe(resolvedConfigPath);
  checks.push(checkEnvironmentVariables(configData));
  checks.push(checkSessionsDirectory());
  checks.push(checkDiskSpace());

  const ok = checks.every((c) => c.status !== "fail");

  return { checks, ok };
}

function checkNodeVersion(): DoctorCheck {
  const version = process.version; // e.g. "v22.12.0"
  const match = version.match(/^v(\d+)\.(\d+)/);
  if (!match) {
    return {
      name: "Node version",
      status: "fail",
      message: `Unable to parse Node.js version: ${version}`,
    };
  }

  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);

  if (
    major > MIN_NODE_MAJOR ||
    (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR)
  ) {
    return {
      name: "Node version",
      status: "pass",
      message: `Node.js ${version} >= v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0`,
    };
  }

  return {
    name: "Node version",
    status: "fail",
    message: `Node.js ${version} is below minimum v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0`,
  };
}

function checkConfigFile(configPath: string): DoctorCheck {
  if (!existsSync(configPath)) {
    return {
      name: "Config file",
      status: "fail",
      message: `Config file not found: ${configPath}`,
    };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    JSON.parse(raw);
    return {
      name: "Config file",
      status: "pass",
      message: `Config file is valid JSON: ${configPath}`,
    };
  } catch {
    return {
      name: "Config file",
      status: "fail",
      message: `Config file is not valid JSON: ${configPath}`,
    };
  }
}

function loadConfigSafe(configPath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

function checkEnvironmentVariables(
  config: Record<string, unknown> | null,
): DoctorCheck {
  if (!config) {
    return {
      name: "Environment variables",
      status: "warn",
      message: "Could not load config; skipping env var check",
    };
  }

  // Determine which API key env var to check based on config
  const agent = config.agent as Record<string, unknown> | undefined;
  const envVarName =
    (agent?.defaultProviderApiKeyEnvVar as string | undefined) ??
    "OPENAI_API_KEY";

  if (process.env[envVarName]) {
    return {
      name: "Environment variables",
      status: "pass",
      message: `${envVarName} is set`,
    };
  }

  return {
    name: "Environment variables",
    status: "fail",
    message: `${envVarName} is not set`,
  };
}

function checkSessionsDirectory(): DoctorCheck {
  if (!existsSync("sessions")) {
    return {
      name: "Sessions directory",
      status: "warn",
      message:
        'Sessions directory does not exist (will be created on first use)',
    };
  }

  try {
    accessSync("sessions", constants.W_OK);
    return {
      name: "Sessions directory",
      status: "pass",
      message: "Sessions directory exists and is writable",
    };
  } catch {
    return {
      name: "Sessions directory",
      status: "fail",
      message: "Sessions directory exists but is not writable",
    };
  }
}

function checkDiskSpace(): DoctorCheck {
  try {
    const output = execFileSync("df", ["-B1", "."], {
      encoding: "utf-8",
      timeout: 5_000,
    });

    // Parse df output: header line + data line
    const lines = output.trim().split("\n");
    if (lines.length < 2) {
      return {
        name: "Disk space",
        status: "pass",
        message: "Could not parse disk space output; skipping",
      };
    }

    // The available column is typically the 4th field
    const fields = lines[1]!.split(/\s+/);
    const available = parseInt(fields[3]!, 10);

    if (isNaN(available)) {
      return {
        name: "Disk space",
        status: "pass",
        message: "Could not parse available disk space; skipping",
      };
    }

    if (available >= MIN_DISK_SPACE_BYTES) {
      const availableMB = Math.floor(available / (1024 * 1024));
      return {
        name: "Disk space",
        status: "pass",
        message: `${availableMB} MB free disk space available`,
      };
    }

    const availableMB = Math.floor(available / (1024 * 1024));
    return {
      name: "Disk space",
      status: "warn",
      message: `Low disk space: ${availableMB} MB free (recommend > 100 MB)`,
    };
  } catch {
    log.debug("Disk space check failed; skipping");
    return {
      name: "Disk space",
      status: "pass",
      message: "Disk space check unavailable on this platform; skipping",
    };
  }
}

/**
 * Format a doctor report as human-readable text.
 * Uses [PASS], [WARN], [FAIL] prefixes.
 */
export function formatDoctorResults(report: DoctorReport): string {
  const lines = report.checks.map((check) => {
    const prefix =
      check.status === "pass"
        ? "[PASS]"
        : check.status === "warn"
          ? "[WARN]"
          : "[FAIL]";
    return `${prefix} ${check.name}: ${check.message}`;
  });

  lines.push("");
  lines.push(
    report.ok ? "All checks passed." : "Some checks failed. See above.",
  );

  return lines.join("\n");
}
