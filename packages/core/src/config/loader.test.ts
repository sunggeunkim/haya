import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateToken,
  initializeConfig,
  loadConfig,
  saveConfig,
} from "./loader.js";
import type { AssistantConfig } from "./types.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `haya-test-${randomBytes(8).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const validConfig: AssistantConfig = {
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: { mode: "token", token: "a".repeat(64) },
    trustedProxies: [],
  },
  agent: {
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
    defaultProviderApiKeyEnvVar: "OPENAI_API_KEY",
    systemPrompt:
      "You are a helpful assistant responding to users in a chat conversation. Reply directly and concisely.",
    maxHistoryMessages: 100,
    toolPolicies: [],
  },
  cron: [],
  plugins: [],
};

describe("generateToken", () => {
  it("generates a 64-character hex string", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 10 }, () => generateToken()));
    expect(tokens.size).toBe(10);
  });
});

describe("saveConfig / loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("saves and loads config with correct permissions", async () => {
    const filePath = join(tempDir, "config.json");
    await saveConfig(filePath, validConfig);

    expect(existsSync(filePath)).toBe(true);

    // Check file permissions are 0o600
    const stats = statSync(filePath);
    expect(stats.mode & 0o777).toBe(0o600);

    const loaded = await loadConfig(filePath);
    expect(loaded.gateway.port).toBe(18789);
    expect(loaded.gateway.auth.mode).toBe("token");
  });

  it("throws when config file does not exist", async () => {
    const filePath = join(tempDir, "nonexistent.json");
    await expect(loadConfig(filePath)).rejects.toThrow(/Config file not found/);
  });

  it("throws on invalid JSON or JSON5", async () => {
    const filePath = join(tempDir, "bad.json");
    writeFileSync(filePath, "not json{", { mode: 0o600 });
    await expect(loadConfig(filePath)).rejects.toThrow(
      /not valid JSON or JSON5/,
    );
  });

  it("throws on schema-invalid config", async () => {
    const filePath = join(tempDir, "invalid.json");
    writeFileSync(
      filePath,
      JSON.stringify({ gateway: { auth: { mode: "none" } } }),
      { mode: 0o600 },
    );
    await expect(loadConfig(filePath)).rejects.toThrow(/validation failed/);
  });

  it("enforces file permissions on load", async () => {
    const filePath = join(tempDir, "loose.json");
    writeFileSync(filePath, JSON.stringify(validConfig), { mode: 0o644 });

    // loadConfig should fix the permissions
    await loadConfig(filePath);
    const stats = statSync(filePath);
    expect(stats.mode & 0o777).toBe(0o600);
  });
});

describe("JSON5 config support", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads a config with JSON5 comments and trailing commas", async () => {
    const filePath = join(tempDir, "config.json5");
    const json5Content = `{
  // Gateway configuration
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token",
      token: "${"a".repeat(64)}",
    },
    trustedProxies: [],
  },
  /* Agent settings */
  agent: {
    defaultModel: "gpt-4o",
    defaultProviderApiKeyEnvVar: "OPENAI_API_KEY",
    systemPrompt: "You are a helpful assistant responding to users in a chat conversation. Reply directly and concisely.",
    maxHistoryMessages: 100,
    toolPolicies: [],
  },
  cron: [],
  plugins: [],
}`;
    writeFileSync(filePath, json5Content, { mode: 0o600 });

    const loaded = await loadConfig(filePath);
    expect(loaded.gateway.port).toBe(18789);
    expect(loaded.agent.defaultModel).toBe("gpt-4o");
  });

  it("still loads standard JSON configs", async () => {
    const filePath = join(tempDir, "config.json");
    writeFileSync(filePath, JSON.stringify(validConfig), { mode: 0o600 });

    const loaded = await loadConfig(filePath);
    expect(loaded.gateway.port).toBe(18789);
    expect(loaded.gateway.auth.mode).toBe("token");
  });
});

describe("initializeConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a config file with auto-generated token", async () => {
    const filePath = join(tempDir, "config.json");
    const { config, generatedToken } = await initializeConfig(
      filePath,
      "OPENAI_API_KEY",
    );

    expect(existsSync(filePath)).toBe(true);
    expect(generatedToken).toHaveLength(64);
    expect(config.gateway.auth.mode).toBe("token");
    expect(config.gateway.auth.token).toBe(generatedToken);

    // File should have correct permissions
    const stats = statSync(filePath);
    expect(stats.mode & 0o777).toBe(0o600);

    // Should be loadable
    const loaded = await loadConfig(filePath);
    expect(loaded.gateway.auth.token).toBe(generatedToken);
  });

  it("creates parent directories if needed", async () => {
    const filePath = join(tempDir, "nested", "dir", "config.json");
    const { config } = await initializeConfig(filePath, "OPENAI_API_KEY");
    expect(existsSync(filePath)).toBe(true);
    expect(config.gateway.port).toBe(18789);
  });
});
