import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, stat } from "node:fs/promises";
import { dirname } from "node:path";
import JSON5 from "json5";
import { migrateConfig } from "./migrations.js";
import { AssistantConfigSchema } from "./schema.js";
import type { AssistantConfig } from "./types.js";
import { validateConfig } from "./validation.js";

const CONFIG_FILE_MODE = 0o600;

/**
 * Load and validate config from a JSON or JSON5 file.
 * Enforces 0o600 file permissions to protect secrets references.
 */
export async function loadConfig(filePath: string): Promise<AssistantConfig> {
  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  await enforceFilePermissions(filePath);

  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON5.parse(raw);
  } catch {
    throw new Error(`Config file is not valid JSON or JSON5: ${filePath}`);
  }

  const migration = migrateConfig(parsed as Record<string, unknown>);
  if (migration.applied.length > 0) {
    writeFileSync(
      filePath,
      JSON.stringify(migration.config, null, 2) + "\n",
      { mode: CONFIG_FILE_MODE },
    );
  }

  const result = AssistantConfigSchema.safeParse(migration.config);
  if (!result.success) {
    const messages = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(
      `Config validation failed:\n${messages.map((m) => `  - ${m}`).join("\n")}`,
    );
  }

  validateConfig(result.data);
  return result.data;
}

/**
 * Save config to a JSON file with 0o600 permissions.
 */
export async function saveConfig(
  filePath: string,
  config: AssistantConfig,
): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", {
    mode: CONFIG_FILE_MODE,
  });
  await chmod(filePath, CONFIG_FILE_MODE);
}

/**
 * Generate a random 64-hex-character token for first-run setup.
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Initialize a config file on first run with auto-generated token.
 * Returns the generated token so it can be printed once to the user.
 */
export async function initializeConfig(
  filePath: string,
  providerApiKeyEnvVar: string,
): Promise<{ config: AssistantConfig; generatedToken: string }> {
  const token = generateToken();

  const config: AssistantConfig = {
    gateway: {
      port: 18789,
      bind: "loopback",
      auth: {
        mode: "token",
        token,
      },
      trustedProxies: [],
    },
    agent: {
      defaultModel: "gpt-4o",
      defaultProviderApiKeyEnvVar: providerApiKeyEnvVar,
      systemPrompt:
        "You are a helpful assistant responding to users in a chat conversation. Reply directly and concisely.",
      maxHistoryMessages: 100,
      toolPolicies: [],
    },
    cron: [],
    plugins: [],
  };

  await saveConfig(filePath, config);
  return { config, generatedToken: token };
}

async function enforceFilePermissions(filePath: string): Promise<void> {
  const stats = await stat(filePath);
  const currentMode = stats.mode & 0o777;
  if (currentMode !== CONFIG_FILE_MODE) {
    await chmod(filePath, CONFIG_FILE_MODE);
  }
}
