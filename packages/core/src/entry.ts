#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("haya")
  .description("Haya — Personal AI assistant gateway")
  .version("0.1.0");

// --- haya start ---
program
  .command("start")
  .description("Start the gateway server")
  .option("-c, --config <path>", "Path to config file")
  .option("-p, --port <number>", "Override gateway port")
  .action(async (options: { config?: string; port?: string }) => {
    const { loadConfig } = await import("./config/loader.js");
    const { createGateway } = await import("./gateway/server.js");
    const { createLogger } = await import("./infra/logger.js");
    const { CronService } = await import("./cron/service.js");
    const { CronStore } = await import("./cron/store.js");
    const { ChannelRegistry } = await import("./channels/registry.js");
    const { ChannelDock } = await import("./channels/dock.js");

    const log = createLogger("haya");

    try {
      const configPath = options.config ?? "haya.json";
      const config = await loadConfig(configPath);

      // Allow CLI --port to override config
      if (options.port) {
        config.gateway.port = Number.parseInt(options.port, 10);
      }

      // Initialize channel dock
      const channelRegistry = new ChannelRegistry();
      const channelDock = new ChannelDock(channelRegistry);

      // Initialize cron service
      const cronStore = new CronStore(
        configPath.replace(/\.json$/, ".cron.json"),
      );
      const cronService = new CronService(cronStore);
      await cronService.init(config.cron);

      // Create and start the gateway
      const gateway = createGateway({ config });

      // Start cron service
      cronService.start();

      // Start channels
      await channelDock.startAll();

      log.info(`Haya gateway listening on port ${config.gateway.port}`);

      // Graceful shutdown
      const shutdown = async () => {
        log.info("Shutting down...");
        cronService.stop();
        await channelDock.stopAll();
        await gateway.close();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } catch (err) {
      log.error(
        `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// --- haya channels ---
const channelsCmd = program
  .command("channels")
  .description("Manage channel plugins");

channelsCmd
  .command("list")
  .description("List all registered channels and their status")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options: { config?: string }) => {
    const { loadConfig } = await import("./config/loader.js");
    const { ChannelRegistry } = await import("./channels/registry.js");
    const { ChannelDock } = await import("./channels/dock.js");

    const configPath = options.config ?? "haya.json";
    await loadConfig(configPath);
    const registry = new ChannelRegistry();
    const dock = new ChannelDock(registry);
    const status = dock.status();

    if (status.channels.length === 0) {
      console.log("No channels registered.");
    } else {
      for (const ch of status.channels) {
        const state = ch.status.connected ? "connected" : "disconnected";
        console.log(`  ${ch.id} (${ch.name}): ${state}`);
      }
    }
  });

channelsCmd
  .command("start <id>")
  .description("Start a specific channel")
  .action(async (id: string) => {
    console.log(`Channel start for "${id}" requires a running gateway. Use 'haya start' and the gateway API.`);
  });

channelsCmd
  .command("stop <id>")
  .description("Stop a specific channel")
  .action(async (id: string) => {
    console.log(`Channel stop for "${id}" requires a running gateway. Use 'haya start' and the gateway API.`);
  });

// --- haya cron ---
const cronCmd = program
  .command("cron")
  .description("Manage cron jobs");

cronCmd
  .command("list")
  .description("List all cron jobs")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options: { config?: string }) => {
    const { loadConfig } = await import("./config/loader.js");
    const { CronStore } = await import("./cron/store.js");

    const configPath = options.config ?? "haya.json";
    const config = await loadConfig(configPath);
    const store = new CronStore(configPath.replace(/\.json$/, ".cron.json"));
    await store.load(config.cron);

    const jobs = store.list();
    if (jobs.length === 0) {
      console.log("No cron jobs configured.");
    } else {
      for (const job of jobs) {
        const state = job.enabled ? "enabled" : "disabled";
        const lastRun = job.lastRunAt
          ? new Date(job.lastRunAt).toISOString()
          : "never";
        console.log(
          `  ${job.name} [${state}] — ${job.schedule} — last run: ${lastRun}`,
        );
      }
    }
  });

cronCmd
  .command("add")
  .description("Add a new cron job")
  .requiredOption("-n, --name <name>", "Job name")
  .requiredOption("-s, --schedule <cron>", "Cron expression")
  .requiredOption("-a, --action <action>", "Action to execute")
  .option("--disabled", "Create the job as disabled")
  .option("-c, --config <path>", "Path to config file")
  .action(
    async (options: {
      name: string;
      schedule: string;
      action: string;
      disabled?: boolean;
      config?: string;
    }) => {
      const { loadConfig } = await import("./config/loader.js");
      const { CronStore } = await import("./cron/store.js");

      const configPath = options.config ?? "haya.json";
      const config = await loadConfig(configPath);
      const store = new CronStore(configPath.replace(/\.json$/, ".cron.json"));
      await store.load(config.cron);

      const entry = store.add({
        name: options.name,
        schedule: options.schedule,
        action: options.action,
        enabled: !options.disabled,
      });
      await store.save();
      console.log(`Added job "${entry.name}" (${entry.id})`);
    },
  );

cronCmd
  .command("remove <id>")
  .description("Remove a cron job by ID")
  .option("-c, --config <path>", "Path to config file")
  .action(async (id: string, options: { config?: string }) => {
    const { loadConfig } = await import("./config/loader.js");
    const { CronStore } = await import("./cron/store.js");

    const configPath = options.config ?? "haya.json";
    const config = await loadConfig(configPath);
    const store = new CronStore(configPath.replace(/\.json$/, ".cron.json"));
    await store.load(config.cron);

    const removed = store.remove(id);
    if (removed) {
      await store.save();
      console.log(`Removed job "${id}"`);
    } else {
      console.error(`Job "${id}" not found.`);
      process.exit(1);
    }
  });

// --- haya config show ---
program
  .command("config")
  .command("show")
  .description("Display current config (secrets redacted)")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options: { config?: string }) => {
    const { loadConfig } = await import("./config/loader.js");
    const { redactSensitive } = await import("./infra/logger.js");

    const configPath = options.config ?? "haya.json";
    const config = await loadConfig(configPath);
    const redacted = redactSensitive(config);
    console.log(JSON.stringify(redacted, null, 2));
  });

program.parse();
