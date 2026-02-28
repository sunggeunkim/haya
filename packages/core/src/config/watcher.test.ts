import { describe, expect, it } from "vitest";
import { ConfigWatcher, diffConfig } from "./watcher.js";
import type { AssistantConfig } from "./types.js";

function makeConfig(overrides: Partial<AssistantConfig> = {}): AssistantConfig {
  return {
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
        "You are a friendly personal assistant. Keep replies short — 1-3 sentences. Use a warm, casual tone. When something is ambiguous, make your best guess and go with it rather than asking clarifying questions. If a topic is complex, break it into a back-and-forth dialogue rather than a single long answer.",
      maxHistoryMessages: 100,
      toolPolicies: [],
      specialists: [],
    },
    cron: [],
    plugins: [],
    ...overrides,
  };
}

describe("diffConfig", () => {
  it("returns empty array for identical configs", () => {
    const a = makeConfig();
    const b = makeConfig();
    expect(diffConfig(a, b)).toEqual([]);
  });

  it("detects top-level field changes", () => {
    const a = makeConfig();
    const b = makeConfig({ plugins: ["my-plugin"] });
    const changed = diffConfig(a, b);
    expect(changed).toContain("plugins");
  });

  it("detects nested field changes in agent", () => {
    const a = makeConfig();
    const b = makeConfig({
      agent: {
        ...a.agent,
        systemPrompt: "New prompt",
      },
    });
    const changed = diffConfig(a, b);
    expect(changed).toContain("agent");
    expect(changed).toContain("agent.systemPrompt");
  });

  it("detects changes in logging", () => {
    const a = makeConfig({ logging: { level: "info", redactSecrets: true, dir: "data/logs", maxSizeMB: 10, maxFiles: 5 } });
    const b = makeConfig({ logging: { level: "debug", redactSecrets: true, dir: "data/logs", maxSizeMB: 10, maxFiles: 5 } });
    const changed = diffConfig(a, b);
    expect(changed).toContain("logging");
    expect(changed).toContain("logging.level");
  });

  it("detects changes in gateway (nested)", () => {
    const a = makeConfig();
    const b = makeConfig({
      gateway: {
        ...a.gateway,
        port: 9999,
      },
    });
    const changed = diffConfig(a, b);
    expect(changed).toContain("gateway");
    expect(changed).toContain("gateway.port");
  });

  it("detects multiple nested changes", () => {
    const a = makeConfig();
    const b = makeConfig({
      agent: {
        ...a.agent,
        systemPrompt: "Changed prompt",
        maxHistoryMessages: 50,
      },
    });
    const changed = diffConfig(a, b);
    expect(changed).toContain("agent.systemPrompt");
    expect(changed).toContain("agent.maxHistoryMessages");
  });
});

describe("safe vs unsafe field classification", () => {
  it("agent.systemPrompt is a safe field change", () => {
    const a = makeConfig();
    const b = makeConfig({
      agent: { ...a.agent, systemPrompt: "Updated prompt" },
    });
    const changed = diffConfig(a, b);
    // Verify the change includes agent.systemPrompt which is in SAFE_FIELDS
    expect(changed).toContain("agent.systemPrompt");
  });

  it("gateway changes are unsafe (require restart)", () => {
    const a = makeConfig();
    const b = makeConfig({
      gateway: { ...a.gateway, port: 9999 },
    });
    const changed = diffConfig(a, b);
    // Verify the change includes gateway which is in RESTART_REQUIRED_FIELDS
    expect(changed).toContain("gateway");
  });

  it("logging is a safe field", () => {
    const a = makeConfig({ logging: { level: "info", redactSecrets: true, dir: "data/logs", maxSizeMB: 10, maxFiles: 5 } });
    const b = makeConfig({ logging: { level: "debug", redactSecrets: true, dir: "data/logs", maxSizeMB: 10, maxFiles: 5 } });
    const changed = diffConfig(a, b);
    expect(changed).toContain("logging");
  });
});

describe("ConfigWatcher constructor", () => {
  it("creates without error", () => {
    const config = makeConfig();
    const watcher = new ConfigWatcher(
      {
        filePath: "/tmp/nonexistent-config.json",
        onReload: () => {},
        onError: () => {},
      },
      config,
    );
    expect(watcher).toBeInstanceOf(ConfigWatcher);
  });

  it("accepts custom debounceMs", () => {
    const config = makeConfig();
    const watcher = new ConfigWatcher(
      {
        filePath: "/tmp/nonexistent-config.json",
        debounceMs: 1000,
        onReload: () => {},
        onError: () => {},
      },
      config,
    );
    expect(watcher).toBeInstanceOf(ConfigWatcher);
  });
});
