#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";

const program = new Command();

program
  .name("haya")
  .description("Haya — Personal AI assistant gateway")
  .version("0.1.0");

// --- haya init ---
program
  .command("init")
  .description("Create a new haya.json config file with a generated token")
  .option("-c, --config <path>", "Path to config file", "haya.json")
  .option(
    "--provider-key-env <var>",
    "Env var name for the AI provider API key",
    "OPENAI_API_KEY",
  )
  .action(async (options: { config: string; providerKeyEnv: string }) => {
    const { existsSync } = await import("node:fs");
    const { initializeConfig } = await import("./config/loader.js");

    if (existsSync(options.config)) {
      console.error(`Config file already exists: ${options.config}`);
      process.exit(1);
    }

    const { generatedToken } = await initializeConfig(
      options.config,
      options.providerKeyEnv,
    );

    console.log(`Created ${options.config} (permissions: 0600)`);
    console.log();
    console.log("Add this to your .env file:");
    console.log(`  ASSISTANT_GATEWAY_TOKEN=${generatedToken}`);
    console.log();
    console.log("Then start the gateway:");
    console.log("  pnpm dev start");
  });

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
    const { createProvider } = await import("./agent/providers.js");
    const { AgentRuntime } = await import("./agent/runtime.js");
    const { SessionStore } = await import("./sessions/store.js");
    const { HistoryManager } = await import("./sessions/history.js");
    const { ToolPolicyEngine } = await import("./agent/tool-policy.js");
    const { UsageTracker } = await import("./sessions/usage.js");
    const { MessageRouter } = await import("./channels/router.js");

    const log = createLogger("haya");

    try {
      // Non-blocking update check
      import("./cli/update.js")
        .then(({ checkForUpdate, formatUpdateNotice }) =>
          checkForUpdate("0.1.0").then((info) => {
            const notice = formatUpdateNotice(info);
            if (notice) log.info(notice);
          }),
        )
        .catch(() => {
          /* ignore update check failures */
        });

      const configPath = options.config ?? "haya.json";
      const config = await loadConfig(configPath);

      // Allow CLI --port to override config
      if (options.port) {
        config.gateway.port = Number.parseInt(options.port, 10);
      }

      // Initialize channel dock
      const channelRegistry = new ChannelRegistry();
      const channelDock = new ChannelDock(channelRegistry);

      // Auto-register channels based on environment variables
      if (process.env.SLACK_BOT_TOKEN) {
        try {
          const { createSlackChannel } = await import("@haya/slack");
          channelRegistry.register(createSlackChannel());
          log.info("Slack channel detected via SLACK_BOT_TOKEN");
        } catch {
          log.warn("SLACK_BOT_TOKEN set but @haya/slack not installed");
        }
      }
      if (process.env.DISCORD_BOT_TOKEN) {
        try {
          const { createDiscordChannel } = await import("@haya/discord");
          channelRegistry.register(createDiscordChannel());
          log.info("Discord channel detected via DISCORD_BOT_TOKEN");
        } catch {
          log.warn("DISCORD_BOT_TOKEN set but @haya/discord not installed");
        }
      }
      if (process.env.TELEGRAM_BOT_TOKEN) {
        try {
          const { createTelegramChannel } = await import("@haya/telegram");
          channelRegistry.register(createTelegramChannel());
          log.info("Telegram channel detected via TELEGRAM_BOT_TOKEN");
        } catch {
          log.warn("TELEGRAM_BOT_TOKEN set but @haya/telegram not installed");
        }
      }

      // Initialize tool policy engine
      const toolPolicies = config.agent.toolPolicies ?? [];
      const policyEngine = new ToolPolicyEngine(toolPolicies);

      // Initialize agent runtime for channel messages
      const provider = createProvider({
        provider: "openai",
        model: config.agent.defaultModel,
        apiKeyEnvVar: config.agent.defaultProviderApiKeyEnvVar,
      });
      const { builtinTools, createSessionTools } = await import(
        "./agent/builtin-tools.js"
      );
      const agentRuntime = new AgentRuntime(provider, {
        defaultModel: config.agent.defaultModel,
        systemPrompt: config.agent.systemPrompt,
      });

      // Set up policy engine on tool registry
      agentRuntime.tools.setPolicyEngine(policyEngine);

      // Register built-in tools
      for (const tool of builtinTools) {
        agentRuntime.tools.register(tool);
      }

      // Register session tools
      const sessionTools = createSessionTools("sessions");
      for (const tool of sessionTools) {
        agentRuntime.tools.register(tool);
      }

      if (config.tools?.googleMapsApiKeyEnvVar) {
        const { createMapsTools } = await import("./agent/maps-tools.js");
        for (const tool of createMapsTools(config.tools.googleMapsApiKeyEnvVar)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Google Maps tools registered");
      }
      const sessionStore = new SessionStore("sessions");
      const historyManager = new HistoryManager(
        sessionStore,
        config.agent.maxHistoryMessages,
      );

      // Initialize usage tracker
      const usageTracker = new UsageTracker("data");

      // Initialize sender auth (if configured)
      let senderAuth: import("./security/sender-auth.js").SenderAuthManager | null = null;
      if (config.senderAuth) {
        const { SenderAuthManager } = await import("./security/sender-auth.js");
        senderAuth = new SenderAuthManager({
          mode: config.senderAuth.mode,
          dataDir: config.senderAuth.dataDir,
        });
        log.info(`Sender auth enabled in ${config.senderAuth.mode} mode`);
      }

      // Initialize message router for group chats
      const messageRouter = new MessageRouter({
        groupChatMode: "mentions",
        botNames: ["haya"],
      });

      // Wire channel messages to the agent runtime
      channelDock.onMessage(async (msg) => {
        // Check sender auth
        if (senderAuth) {
          const senderStatus = await senderAuth.checkSender(msg.senderId);
          if (senderStatus !== "allowed") {
            if (senderStatus === "unknown" && senderAuth.getMode() === "pairing") {
              const code = await senderAuth.createPairingCode(msg.senderId);
              const channel = channelRegistry.get(msg.channel);
              if (channel) {
                await channel.sendMessage(msg.channelId, {
                  content: `You are not yet authorized. Your pairing code is: ${code}\nAsk the admin to run: haya senders approve ${code}`,
                  threadId: msg.threadId,
                });
              }
            }
            log.info(`Blocked message from unauthorized sender ${msg.senderId}`);
            return;
          }
        }

        // Check message router for group chat filtering
        if (!messageRouter.shouldProcess(msg).process) {
          return;
        }

        const rawKey =
          (msg.metadata?.sessionKey as string) ??
          `${msg.channel}:${msg.channelId}`;
        const sessionKey = rawKey.replace(/:/g, "-");

        log.info(`Processing message from ${msg.senderId} in session ${sessionKey}`);

        const history = historyManager.getHistory(sessionKey);
        const response = await agentRuntime.chat(
          { sessionId: sessionKey, message: msg.content },
          history,
        );

        // Track usage
        if (response.usage) {
          usageTracker.record(
            sessionKey,
            config.agent.defaultModel,
            response.usage,
          );
        }

        // Persist conversation
        historyManager.addMessages(sessionKey, [
          { role: "user", content: msg.content, timestamp: msg.timestamp },
          response.message,
        ]);

        // Send reply back to the channel
        const channel = channelRegistry.get(msg.channel);
        if (channel && response.message.content) {
          await channel.sendMessage(msg.channelId, {
            content: response.message.content,
            threadId: msg.threadId,
          });
        }
      });

      // Initialize cron service
      const cronStore = new CronStore(
        configPath.replace(/\.json$/, ".cron.json"),
      );
      const cronService = new CronService(cronStore);
      await cronService.init(config.cron);

      // Wire cron job handler — route actions including session pruning
      cronService.onAction(async (job) => {
        if (job.action === "prune_sessions") {
          const pruningConfig = config.sessions?.pruning;
          if (pruningConfig?.enabled) {
            const result = sessionStore.prune({
              maxAgeDays: pruningConfig.maxAgeDays,
              maxSizeMB: pruningConfig.maxSizeMB,
            });
            if (result.deletedCount > 0) {
              log.info(`Pruned ${result.deletedCount} sessions (freed ${result.freedBytes} bytes)`);
            }
          }
        } else {
          log.warn(`Unknown cron action: ${job.action}`);
        }
      });

      // Create and start the gateway
      const gateway = createGateway({ config });
      await gateway.listen();

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

// --- haya senders ---
const sendersCmd = program
  .command("senders")
  .description("Manage authorized senders");

sendersCmd
  .command("approve <code>")
  .description("Approve a sender by pairing code")
  .option("-d, --data-dir <path>", "Sender data directory", "data/senders")
  .action(async (code: string, options: { dataDir: string }) => {
    const { SenderAuthManager } = await import("./security/sender-auth.js");
    const auth = new SenderAuthManager({ mode: "pairing", dataDir: options.dataDir });
    const result = await auth.approvePairing(code);
    if (result.success) {
      console.log(`Approved sender: ${result.senderId}`);
    } else {
      console.error("Invalid or expired pairing code.");
      process.exit(1);
    }
  });

sendersCmd
  .command("list")
  .description("List all authorized senders")
  .option("-d, --data-dir <path>", "Sender data directory", "data/senders")
  .action(async (options: { dataDir: string }) => {
    const { SenderAuthManager } = await import("./security/sender-auth.js");
    const auth = new SenderAuthManager({ mode: "pairing", dataDir: options.dataDir });
    const senders = await auth.listSenders();
    if (senders.length === 0) {
      console.log("No registered senders.");
    } else {
      for (const s of senders) {
        console.log(`  ${s.senderId}: ${s.status}`);
      }
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

// --- haya audit ---
program
  .command("audit")
  .description("Run security audit checks against the codebase")
  .option(
    "-r, --root <path>",
    "Root directory of the project",
    process.cwd(),
  )
  .action(async (options: { root: string }) => {
    const { runSecurityAudit, formatAuditResults } = await import(
      "./security/audit.js"
    );

    const report = await runSecurityAudit(options.root);
    console.log(formatAuditResults(report));

    if (!report.ok) {
      process.exit(1);
    }
  });

// --- haya doctor ---
program
  .command("doctor")
  .description("Run diagnostic checks on the Haya installation")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options: { config?: string }) => {
    const { runDoctorChecks, formatDoctorResults } = await import(
      "./cli/doctor.js"
    );

    const report = await runDoctorChecks(options.config);
    console.log(formatDoctorResults(report));

    if (!report.ok) {
      process.exit(1);
    }
  });

// --- haya onboard ---
program
  .command("onboard")
  .description("Interactive setup wizard for a new Haya installation")
  .action(async () => {
    const { runOnboardWizard } = await import("./cli/onboard.js");
    await runOnboardWizard();
  });

// --- haya usage ---
program
  .command("usage")
  .description("Show token usage statistics")
  .option("-s, --session <id>", "Filter by session ID")
  .option("--since <date>", "Show usage since date (ISO format)")
  .action(async (options: { session?: string; since?: string }) => {
    const { UsageTracker } = await import("./sessions/usage.js");
    const tracker = new UsageTracker("data");

    if (options.session) {
      const usage = tracker.getSessionUsage(options.session);
      console.log(`Session: ${options.session}`);
      console.log(`  Total tokens: ${usage.totalTokens}`);
      console.log(`  Requests: ${usage.records.length}`);
    } else {
      const since = options.since ? new Date(options.since).getTime() : undefined;
      const usage = tracker.getTotalUsage(since);
      console.log("Usage summary:");
      console.log(`  Total tokens: ${usage.totalTokens}`);
      console.log(`  Prompt tokens: ${usage.promptTokens}`);
      console.log(`  Completion tokens: ${usage.completionTokens}`);
      console.log(`  Requests: ${usage.requestCount}`);

      const byModel = tracker.getUsageByModel(since);
      if (byModel.size > 0) {
        console.log("\nBy model:");
        for (const [model, stats] of byModel) {
          console.log(`  ${model}: ${stats.totalTokens} tokens (${stats.requestCount} requests)`);
        }
      }
    }
  });

program.parse();
