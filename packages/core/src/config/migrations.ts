import { ConfigError } from "../infra/errors.js";

export interface ConfigMigration {
  version: number;
  description: string;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
}

export interface MigrationResult {
  config: Record<string, unknown>;
  applied: ConfigMigration[];
  fromVersion: number;
  toVersion: number;
}

/**
 * Ordered list of config migrations. Each migration upgrades from
 * version (N-1) to version N.
 */
export const migrations: ConfigMigration[] = [
  {
    version: 1,
    description: "Establish configVersion field for migration tracking",
    migrate(config) {
      return { ...config, configVersion: 1 };
    },
  },
  {
    version: 2,
    description: "Remove empty agent.providers array",
    migrate(config) {
      const agent = config.agent as Record<string, unknown> | undefined;
      if (agent && Array.isArray(agent.providers) && agent.providers.length === 0) {
        const { providers: _, ...restAgent } = agent;
        return { ...config, agent: restAgent, configVersion: 2 };
      }
      return { ...config, configVersion: 2 };
    },
  },
];

export const CURRENT_CONFIG_VERSION: number =
  migrations[migrations.length - 1]?.version ?? 0;

/**
 * Run all applicable migrations on a raw config object.
 *
 * - If `configVersion` is missing, it is treated as version 0.
 * - If `configVersion` is higher than the latest known migration,
 *   a ConfigError is thrown (config is from a newer version of Haya).
 * - Returns the migrated config and metadata about what was applied.
 */
export function migrateConfig(
  rawConfig: Record<string, unknown>,
): MigrationResult {
  const fromVersion =
    typeof rawConfig.configVersion === "number" ? rawConfig.configVersion : 0;

  if (fromVersion > CURRENT_CONFIG_VERSION) {
    throw new ConfigError(
      `Config version ${fromVersion} is newer than the latest supported version ` +
        `(${CURRENT_CONFIG_VERSION}). Please upgrade Haya.`,
    );
  }

  const applied: ConfigMigration[] = [];
  let config = { ...rawConfig };

  for (const migration of migrations) {
    if (migration.version > fromVersion) {
      config = migration.migrate(config);
      applied.push(migration);
    }
  }

  // Ensure configVersion is set to the latest even if no migrations ran
  config.configVersion = CURRENT_CONFIG_VERSION;

  return {
    config,
    applied,
    fromVersion,
    toVersion: CURRENT_CONFIG_VERSION,
  };
}
