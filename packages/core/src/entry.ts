#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("haya")
  .description("Haya — Personal AI assistant gateway")
  .version("0.1.0");

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

program.parse();
