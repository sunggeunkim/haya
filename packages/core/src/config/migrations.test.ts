import { describe, expect, it } from "vitest";
import {
  CURRENT_CONFIG_VERSION,
  migrateConfig,
  migrations,
} from "./migrations.js";

const baseConfig: Record<string, unknown> = {
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
    systemPrompt: "You are a helpful assistant.",
    maxHistoryMessages: 100,
    toolPolicies: [],
  },
  cron: [],
  plugins: [],
};

describe("migrateConfig", () => {
  it("migrates a config with no configVersion to the latest version", () => {
    const result = migrateConfig({ ...baseConfig });

    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.applied.length).toBe(migrations.length);
    expect(result.config.configVersion).toBe(CURRENT_CONFIG_VERSION);
  });

  it("does not apply migrations to a config already at the current version", () => {
    const config = { ...baseConfig, configVersion: CURRENT_CONFIG_VERSION };
    const result = migrateConfig(config);

    expect(result.fromVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.applied).toEqual([]);
    expect(result.config.configVersion).toBe(CURRENT_CONFIG_VERSION);
  });

  it("throws a ConfigError for a config version newer than supported", () => {
    const futureConfig = {
      ...baseConfig,
      configVersion: CURRENT_CONFIG_VERSION + 1,
    };
    expect(() => migrateConfig(futureConfig)).toThrow(
      /newer than the latest supported version/,
    );
  });

  it("preserves all existing fields through migration", () => {
    const config = {
      ...baseConfig,
      memory: { enabled: true, dbPath: "/tmp/memory.db" },
      logging: { level: "debug", redactSecrets: true },
      customField: "should-survive",
    };

    const result = migrateConfig(config);

    expect(result.config.memory).toEqual({
      enabled: true,
      dbPath: "/tmp/memory.db",
    });
    expect(result.config.logging).toEqual({
      level: "debug",
      redactSecrets: true,
    });
    expect(result.config.customField).toBe("should-survive");
  });

  it("applies only pending migrations for a partially migrated config", () => {
    const config = { ...baseConfig, configVersion: 1 };
    const result = migrateConfig(config);

    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.applied.length).toBe(CURRENT_CONFIG_VERSION - 1);
    expect(result.applied[0].version).toBe(2);
  });
});

describe("migration 1: establish configVersion", () => {
  it("sets configVersion to 1 on a v0 config", () => {
    const migration = migrations.find((m) => m.version === 1)!;
    const result = migration.migrate({ ...baseConfig });
    expect(result.configVersion).toBe(1);
  });
});

describe("migration 2: remove empty agent.providers", () => {
  const migration = migrations.find((m) => m.version === 2)!;

  it("removes agent.providers when it is an empty array", () => {
    const config = {
      ...baseConfig,
      agent: { ...(baseConfig.agent as Record<string, unknown>), providers: [] },
    };
    const result = migration.migrate(config);
    const agent = result.agent as Record<string, unknown>;

    expect(agent.providers).toBeUndefined();
    expect(result.configVersion).toBe(2);
  });

  it("keeps agent.providers when it is a non-empty array", () => {
    const config = {
      ...baseConfig,
      agent: {
        ...(baseConfig.agent as Record<string, unknown>),
        providers: [{ name: "openai", apiKeyEnvVar: "OPENAI_API_KEY" }],
      },
    };
    const result = migration.migrate(config);
    const agent = result.agent as Record<string, unknown>;

    expect(agent.providers).toEqual([
      { name: "openai", apiKeyEnvVar: "OPENAI_API_KEY" },
    ]);
    expect(result.configVersion).toBe(2);
  });

  it("does nothing when agent.providers is absent", () => {
    const result = migration.migrate({ ...baseConfig });
    const agent = result.agent as Record<string, unknown>;

    expect(agent.providers).toBeUndefined();
    expect(result.configVersion).toBe(2);
  });
});

describe("migrations array integrity", () => {
  it("has strictly increasing version numbers starting at 1", () => {
    for (let i = 0; i < migrations.length; i++) {
      expect(migrations[i].version).toBe(i + 1);
    }
  });

  it("every migration has a non-empty description", () => {
    for (const m of migrations) {
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it("CURRENT_CONFIG_VERSION matches the last migration version", () => {
    expect(CURRENT_CONFIG_VERSION).toBe(
      migrations[migrations.length - 1].version,
    );
  });
});
