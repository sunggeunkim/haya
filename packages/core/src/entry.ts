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
    const startTime = Date.now();

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
      if (process.env.KAKAO_SKILL_PORT) {
        try {
          const kakao = await import("@haya/kakao" as string);
          channelRegistry.register(kakao.createKakaoChannel());
          log.info("KakaoTalk channel detected via KAKAO_SKILL_PORT");
        } catch {
          log.warn("KAKAO_SKILL_PORT set but @haya/kakao not installed");
        }
      }

      // Initialize tool policy engine
      const toolPolicies = config.agent.toolPolicies ?? [];
      const policyEngine = new ToolPolicyEngine(toolPolicies);

      // Initialize AI provider(s)
      let provider: import("./agent/providers.js").AIProvider;
      if (config.agent.providers && config.agent.providers.length > 0) {
        const { FallbackProvider } = await import("./agent/provider-chain.js");
        const entries = config.agent.providers.map((entry) => ({
          provider: createProvider({
            provider: entry.name,
            model: config.agent.defaultModel,
            apiKeyEnvVar: entry.apiKeyEnvVar,
            baseUrl: entry.baseUrl,
          }),
          models: entry.models,
        }));
        provider = new FallbackProvider(entries);
        log.info(`Provider fallback chain: ${provider.name}`);
      } else {
        const providerName = config.agent.defaultProvider ?? "openai";
        provider = createProvider({
          provider: providerName,
          model: config.agent.defaultModel,
          ...(config.agent.defaultProviderApiKeyEnvVar
            ? { apiKeyEnvVar: config.agent.defaultProviderApiKeyEnvVar }
            : providerName !== "bedrock"
              ? { apiKeyEnvVar: `${providerName.toUpperCase()}_API_KEY` }
              : {}),
          ...(config.agent.awsRegion && { awsRegion: config.agent.awsRegion }),
        });
      }
      // Initialize activity logger
      const { ActivityLogger } = await import("./infra/activity-logger.js");
      const activityLogger = new ActivityLogger({
        dir: config.logging?.dir ?? "data/logs",
        maxSizeMB: config.logging?.maxSizeMB ?? 10,
        maxFiles: config.logging?.maxFiles ?? 5,
        redactSecrets: config.logging?.redactSecrets ?? true,
      });

      const { builtinTools, createSessionTools } = await import(
        "./agent/builtin-tools.js"
      );
      const agentRuntime = new AgentRuntime(provider, {
        defaultModel: config.agent.defaultModel,
        systemPrompt: config.agent.systemPrompt,
      }, { activityLogger });

      // Set up policy engine on tool registry
      agentRuntime.tools.setPolicyEngine(policyEngine);
      agentRuntime.tools.setActivityLogger(activityLogger);

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

      // Register web search tools
      if (config.tools?.webSearch) {
        const { createSearchTools } = await import("./agent/search-tools.js");
        for (const tool of createSearchTools(config.tools.webSearch)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Web search tools registered");
      }

      // Register Twitter search tools
      if (config.tools?.twitterSearch) {
        const { createTwitterSearchTools } = await import("./agent/search-tools.js");
        for (const tool of createTwitterSearchTools(config.tools.twitterSearch)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Twitter search tools registered");
      }

      // Register stock quote tools
      if (config.tools?.stockQuote) {
        const { createFinanceTools } = await import("./agent/finance-tools.js");
        for (const tool of createFinanceTools(config.tools.stockQuote)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Stock quote tools registered");
      }

      // Register flight search tools
      if (config.tools?.flightSearch) {
        const { createFlightTools } = await import("./agent/flight-tools.js");
        for (const tool of createFlightTools(config.tools.flightSearch)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Flight search tools registered");
      }

      // Register Todoist tools
      if (config.tools?.todoist) {
        const { createTodoistTools } = await import("./agent/todoist-tools.js");
        for (const tool of createTodoistTools(config.tools.todoist)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Todoist tools registered");
      }

      // Register YouTube tools
      if (config.tools?.youtube) {
        const { createYouTubeTools } = await import("./agent/youtube-tools.js");
        for (const tool of createYouTubeTools(config.tools.youtube)) {
          agentRuntime.tools.register(tool);
        }
        log.info("YouTube tools registered");
      }

      // Register image generation tools
      if (config.tools?.imageGeneration) {
        const { createImageTools } = await import("./agent/image-tools.js");
        for (const tool of createImageTools(config.tools.imageGeneration.apiKeyEnvVar)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Image generation tools registered");
      }

      // Register Google OAuth tools (Calendar, Gmail, Drive)
      if (config.tools?.google) {
        const { GoogleAuth } = await import("./google/auth.js");
        const googleScopes: string[] = [];
        if (config.tools.google.calendar.enabled) {
          googleScopes.push("https://www.googleapis.com/auth/calendar.events");
        }
        if (config.tools.google.gmail.enabled) {
          googleScopes.push(
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.compose",
          );
        }
        if (config.tools.google.drive.enabled) {
          googleScopes.push(
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/drive.file",
          );
        }
        const googleAuth = new GoogleAuth({
          ...config.tools.google,
          scopes: googleScopes,
        });

        if (config.tools.google.calendar.enabled) {
          const { createCalendarTools } = await import("./agent/google-calendar-tools.js");
          for (const tool of createCalendarTools(googleAuth)) {
            agentRuntime.tools.register(tool);
          }
          log.info("Google Calendar tools registered");
        }
        if (config.tools.google.gmail.enabled) {
          const { createGmailTools } = await import("./agent/google-gmail-tools.js");
          for (const tool of createGmailTools(googleAuth)) {
            agentRuntime.tools.register(tool);
          }
          log.info("Gmail tools registered");
        }
        if (config.tools.google.drive.enabled) {
          const { createDriveTools } = await import("./agent/google-drive-tools.js");
          for (const tool of createDriveTools(googleAuth)) {
            agentRuntime.tools.register(tool);
          }
          log.info("Google Drive tools registered");
        }
      }

      // Register memory tools
      let memoryManager: import("./memory/types.js").MemorySearchManager | null = null;
      if (config.memory?.enabled) {
        const { createMemoryManager } = await import("./memory/manager.js");
        memoryManager = await createMemoryManager({
          dbPath: config.memory.dbPath ?? "data/memory.db",
        });
        const { createMemoryTools } = await import("./agent/memory-tools.js");
        for (const tool of createMemoryTools(memoryManager)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Memory tools registered");
      }

      // Register message tools (cross-channel messaging)
      {
        const { createMessageTools } = await import("./agent/message-tools.js");
        for (const tool of createMessageTools(channelRegistry)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Message tools registered");
      }

      // Register link preview tools
      {
        const { createLinkTools } = await import("./agent/link-tools.js");
        for (const tool of createLinkTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Link preview tools registered");
      }

      // Register code evaluation tools
      {
        const { createCodeEvalTools } = await import("./agent/code-eval-tools.js");
        for (const tool of createCodeEvalTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Code eval tools registered");
      }

      // Register data conversion & diff tools
      {
        const { createDataTools } = await import("./agent/data-tools.js");
        for (const tool of createDataTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Data tools registered");
      }

      // Register hash/encoding tools
      {
        const { createHashTools } = await import("./agent/hash-tools.js");
        for (const tool of createHashTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Hash tools registered");
      }

      // Register weather tools (Open-Meteo, no API key needed)
      {
        const { createWeatherTools } = await import("./agent/weather-tools.js");
        for (const tool of createWeatherTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Weather tools registered");
      }

      // Register Bible tools (bible-api.com + bolls.life, no API key needed)
      {
        const { createBibleTools } = await import("./agent/bible-tools.js");
        for (const tool of createBibleTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Bible tools registered");
      }

      // Register Bible SDK tools (biblesdk.com — Strong's concordance + semantic search)
      {
        const { createBibleSdkTools } = await import("./agent/biblesdk-tools.js");
        for (const tool of createBibleSdkTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Bible SDK tools registered");
      }

      // Register NET Bible tools (labs.bible.org — study notes + random verse)
      {
        const { createNetBibleTools } = await import("./agent/netbible-tools.js");
        for (const tool of createNetBibleTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("NET Bible tools registered");
      }

      // Register Lectionary tools (lectio-api.org — daily readings + liturgical calendar)
      {
        const { createLectionaryTools } = await import("./agent/lectionary-tools.js");
        for (const tool of createLectionaryTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Lectionary tools registered");
      }

      // Register Hymnary tools (hymnary.org — find hymns by scripture reference)
      {
        const { createHymnTools } = await import("./agent/hymn-tools.js");
        for (const tool of createHymnTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Hymnary tools registered");
      }

      // Register Bible-by-topic tools (biblebytopic.com — topical verse lookup)
      {
        const { createBibleTopicTools } = await import("./agent/bible-topic-tools.js");
        for (const tool of createBibleTopicTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Bible topic tools registered");
      }

      // Register Bible cross-reference tools (OpenBible.info — ~340K cross-references)
      {
        const { createCrossRefTools } = await import("./agent/cross-ref-tools.js");
        for (const tool of createCrossRefTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Bible cross-reference tools registered");
      }

      // Register HelloAO Bible tools (bible.helloao.org — 1,000+ translations)
      {
        const { createHelloAoTools } = await import("./agent/helloao-tools.js");
        for (const tool of createHelloAoTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("HelloAO Bible tools registered");
      }

      // Register BibleHub tools (biblehub.com — commentaries + interlinear)
      {
        const { createBibleHubTools } = await import("./agent/biblehub-tools.js");
        for (const tool of createBibleHubTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("BibleHub tools registered");
      }

      // Register HTTP request tools
      {
        const { createHttpTools } = await import("./agent/http-tools.js");
        for (const tool of createHttpTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("HTTP tools registered");
      }

      // Register system tools (clipboard, screenshot, notify, system_info)
      {
        const { createSystemTools } = await import("./agent/system-tools.js");
        for (const tool of createSystemTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("System tools registered");
      }

      // Register PDF/document extraction tools
      {
        const { createPdfTools } = await import("./agent/pdf-tools.js");
        for (const tool of createPdfTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("PDF tools registered");
      }

      // Register archive tools
      {
        const { createArchiveTools } = await import("./agent/archive-tools.js");
        for (const tool of createArchiveTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Archive tools registered");
      }

      // Register QR code tools
      {
        const { createQrTools } = await import("./agent/qr-tools.js");
        for (const tool of createQrTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("QR code tools registered");
      }

      // Register audio transcription tools (requires OpenAI API key)
      if (config.agent.defaultProviderApiKeyEnvVar || process.env.OPENAI_API_KEY) {
        const { createAudioTools } = await import("./agent/audio-tools.js");
        const audioKeyEnvVar = config.agent.defaultProviderApiKeyEnvVar ?? "OPENAI_API_KEY";
        for (const tool of createAudioTools(audioKeyEnvVar)) {
          agentRuntime.tools.register(tool);
        }
        log.info("Audio transcription tools registered");
      }

      // Register vision/image analysis tools
      {
        const { createVisionTools } = await import("./agent/vision-tools.js");
        for (const tool of createVisionTools()) {
          agentRuntime.tools.register(tool);
        }
        log.info("Vision tools registered");
      }

      // Register per-sender profile tools
      const { SenderProfileStore } = await import("./sessions/profile-store.js");
      const { createProfileTools } = await import("./agent/profile-tools.js");
      const profileStore = new SenderProfileStore("data/profiles");
      const { tools: profileTools, setSenderId: setProfileSenderId } = createProfileTools(profileStore);
      for (const tool of profileTools) {
        agentRuntime.tools.register(tool);
      }
      log.info("User profile tools registered");

      // Register delegation tools (multi-agent)
      if (config.agent.specialists.length > 0) {
        const { createDelegationTools } = await import("./agent/delegation.js");
        for (const tool of createDelegationTools({
          provider,
          defaultModel: config.agent.defaultModel,
          sourceTools: agentRuntime.tools,
          specialists: config.agent.specialists,
        })) {
          agentRuntime.tools.register(tool);
        }
        log.info(`Delegation tools registered (${config.agent.specialists.length} specialists)`);
      }

      const sessionStore = new SessionStore("sessions");
      const historyManager = new HistoryManager(
        sessionStore,
        config.agent.maxHistoryMessages,
      );

      // Estimate system prompt tokens once at startup for context budgeting
      const { createSimpleTokenCounter } = await import("./agent/token-counter.js");
      const tokenCounter = createSimpleTokenCounter();
      const baseSystemPromptTokens = tokenCounter.count(config.agent.systemPrompt);

      // Context window guard
      const { resolveContextWindow, evaluateContextWindowGuard } = await import("./agent/context-window-guard.js");
      const ctxWindowInfo = resolveContextWindow(config.agent.maxContextTokens);
      const ctxGuard = evaluateContextWindowGuard({ info: ctxWindowInfo });
      if (ctxGuard.shouldBlock) {
        throw new (await import("./infra/errors.js")).ConfigError(
          `Context window too small: ${ctxGuard.tokens} tokens (minimum: 16,000). ` +
          `Increase agent.maxContextTokens in your config.`,
        );
      }
      if (ctxGuard.shouldWarn) {
        log.warn(
          `Context window is small: ${ctxGuard.tokens} tokens (source: ${ctxGuard.source}). ` +
          `Consider increasing agent.maxContextTokens for better performance.`,
        );
      }

      // Resolve context pruning settings (if enabled)
      const contextPruningSettings = await (async () => {
        const cp = config.agent.contextPruning;
        if (!cp?.enabled) return undefined;
        const { DEFAULT_CONTEXT_PRUNING_SETTINGS } = await import("./agent/context-pruning.js");
        return {
          ...DEFAULT_CONTEXT_PRUNING_SETTINGS,
          ...cp,
          softTrim: { ...DEFAULT_CONTEXT_PRUNING_SETTINGS.softTrim, ...cp.softTrim },
          hardClear: { ...DEFAULT_CONTEXT_PRUNING_SETTINGS.hardClear, ...cp.hardClear },
        };
      })();

      // Build summarizer config (if compaction mode is "summarize")
      const summarizerConfig = (() => {
        const compaction = config.agent.compaction;
        if (compaction?.mode !== "summarize") return undefined;
        return {
          complete: async (msgs: import("./agent/types.js").Message[]) => {
            const resp = await provider.complete({
              model: compaction.model ?? config.agent.defaultModel,
              messages: msgs,
              maxTokens: compaction.reserveTokens ?? 2048,
            });
            return resp.message.content;
          },
          model: compaction.model ?? config.agent.defaultModel,
          reserveTokens: compaction.reserveTokens ?? 2048,
        };
      })();

      // Memory flush settings (only when memory is enabled)
      const memoryFlushSettings = await (async () => {
        if (!config.memory?.enabled) return null;
        const mf = config.agent.compaction?.memoryFlush;
        if (mf && !mf.enabled) return null;
        const { shouldRunMemoryFlush, estimateSessionTokens, buildMemoryFlushMessages } =
          await import("./agent/memory-flush.js");
        return {
          softThresholdTokens: mf?.softThresholdTokens ?? 4000,
          shouldRunMemoryFlush,
          estimateSessionTokens,
          buildMemoryFlushMessages,
        };
      })();

      // Track memory flush state per session
      const memoryFlushState = new Map<string, boolean>();

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

      // Initialize auto-reply system
      let autoReplyEngine: import("./channels/auto-reply.js").AutoReplyEngine | null = null;
      if (config.autoReply?.enabled) {
        const { AutoReplyEngine } = await import("./channels/auto-reply.js");
        const { AutoReplyStore } = await import("./channels/auto-reply-store.js");
        const { createAutoReplyTools } = await import("./agent/auto-reply-tools.js");

        const autoReplyStore = new AutoReplyStore(
          configPath.replace(/\.json$/, ".auto-reply.json"),
        );
        await autoReplyStore.load(config.autoReply.rules);

        autoReplyEngine = new AutoReplyEngine(autoReplyStore.list());

        for (const tool of createAutoReplyTools(autoReplyStore, autoReplyEngine)) {
          agentRuntime.tools.register(tool);
        }
        log.info(`Auto-reply enabled with ${autoReplyStore.size} rules`);
      }

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

        // Auto-reply interception
        if (autoReplyEngine) {
          const matches = autoReplyEngine.check(msg.content, msg.channel);
          if (matches.length > 0) {
            const channel = channelRegistry.get(msg.channel);
            if (channel) {
              for (const m of matches) {
                await channel.sendMessage(msg.channelId, {
                  content: m.reply,
                  threadId: msg.threadId,
                });
              }
            }
            // If no matching rule wants passthrough, skip AI processing
            if (!autoReplyEngine.shouldForwardToAI(msg.content, msg.channel)) {
              return;
            }
          }
        }

        const rawKey =
          (msg.metadata?.sessionKey as string) ??
          `${msg.channel}:${msg.channelId}`;
        const sessionKey = rawKey.replace(/:/g, "-");

        const chatStartTime = Date.now();
        log.info(`Processing message from ${msg.senderId} in session ${sessionKey}`);

        // Set sender context for profile tools
        setProfileSenderId(msg.senderId);

        // Load user profile and inject into system prompt
        const profile = await profileStore.load(msg.senderId);
        let systemPromptOverride: string | undefined;
        if (Object.keys(profile).length > 0) {
          const profileText = profileStore.formatForPrompt(profile);
          const basePrompt = config.agent.systemPrompt;
          systemPromptOverride = `${basePrompt}\n\n${profileText}`;
        }

        // Pre-compaction memory flush (if enabled and near context limit)
        if (memoryFlushSettings) {
          const rawMessages = historyManager.getHistory(sessionKey);
          const sessionTokens = memoryFlushSettings.estimateSessionTokens(rawMessages, tokenCounter);
          const hasRun = memoryFlushState.get(sessionKey) ?? false;
          if (memoryFlushSettings.shouldRunMemoryFlush({
            totalTokens: sessionTokens,
            contextWindowTokens: config.agent.maxContextTokens,
            reserveTokens: config.agent.compaction?.reserveTokens ?? 4096,
            softThresholdTokens: memoryFlushSettings.softThresholdTokens,
            hasRunForCycle: hasRun,
          })) {
            log.info(`Running pre-compaction memory flush for session ${sessionKey}`);
            const flushMessages = memoryFlushSettings.buildMemoryFlushMessages();
            try {
              await agentRuntime.chat(
                { sessionId: sessionKey, message: flushMessages[1].content },
                rawMessages,
              );
              memoryFlushState.set(sessionKey, true);
            } catch (err) {
              log.warn(`Memory flush failed for session ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }

        const historyOptions = {
          maxTokens: config.agent.maxContextTokens,
          systemPromptTokens: systemPromptOverride
            ? tokenCounter.count(systemPromptOverride)
            : baseSystemPromptTokens,
          contextPruning: contextPruningSettings,
          summarizer: summarizerConfig,
        };
        const history = summarizerConfig
          ? await historyManager.getHistoryAsync(sessionKey, historyOptions)
          : historyManager.getHistory(sessionKey, historyOptions);
        const response = await agentRuntime.chat(
          {
            sessionId: sessionKey,
            message: msg.content,
            ...(systemPromptOverride && { systemPrompt: systemPromptOverride }),
          },
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

        // Log activity
        activityLogger.logActivity({
          sessionId: sessionKey,
          channel: msg.channel,
          senderId: msg.senderId,
          messagePreview: msg.content.substring(0, 100),
          responsePreview: (response.message.content ?? "").substring(0, 100),
          totalTokens: response.usage?.totalTokens,
          toolsUsed: response.toolsUsed ?? [],
          totalDurationMs: Date.now() - chatStartTime,
        });

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

      // Register gateway status tools
      {
        const { createGatewayTools } = await import("./agent/gateway-tools.js");
        for (const tool of createGatewayTools({
          config,
          uptime: () => Date.now() - startTime,
          channelRegistry,
          cronService,
        })) {
          agentRuntime.tools.register(tool);
        }
        log.info("Gateway tools registered");
      }

      // Register reminder tools (always available, uses cron service)
      const { createReminderTools } = await import("./agent/reminder-tools.js");
      for (const tool of createReminderTools(cronService)) {
        agentRuntime.tools.register(tool);
      }
      log.info("Reminder tools registered");

      // Wire cron job handler — route actions including session pruning and reminders
      cronService.onAction(async (job) => {
        if (job.action === "send_reminder") {
          const meta = job.metadata ?? {};
          const message = (meta.message as string) ?? "Reminder (no message set)";
          // Deliver reminder to all connected channels
          for (const ch of channelRegistry.list()) {
            try {
              await ch.sendMessage("default", {
                content: `🔔 Reminder: ${message}`,
              });
            } catch {
              // Channel may not support default destination; skip
            }
          }
          // One-shot reminder: auto-remove after firing
          await cronService.removeJob(job.id);
          log.info(`Reminder delivered and removed: ${job.id}`);
        } else if (job.action === "prune_sessions") {
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
        } else if (job.action === "agent_prompt") {
          const meta = job.metadata ?? {};
          const prompt = meta.prompt as string;
          if (!prompt) {
            log.warn(`agent_prompt job ${job.id} has no prompt — skipping`);
            return;
          }

          const sessionKey = `cron-${job.id}`;
          const cronChatStart = Date.now();
          const cronHistoryOpts = {
            maxTokens: config.agent.maxContextTokens,
            systemPromptTokens: baseSystemPromptTokens,
            contextPruning: contextPruningSettings,
            summarizer: summarizerConfig,
          };
          const history = summarizerConfig
            ? await historyManager.getHistoryAsync(sessionKey, cronHistoryOpts)
            : historyManager.getHistory(sessionKey, cronHistoryOpts);

          // Optional model override
          const modelOverride = meta.model as string | undefined;
          const response = await agentRuntime.chat(
            { sessionId: sessionKey, message: prompt, ...(modelOverride && { model: modelOverride }) },
            history,
          );

          // Track usage
          if (response.usage) {
            usageTracker.record(
              sessionKey,
              modelOverride ?? config.agent.defaultModel,
              response.usage,
            );
          }

          // Log activity
          activityLogger.logActivity({
            sessionId: sessionKey,
            channel: "cron",
            senderId: "system",
            messagePreview: prompt.substring(0, 100),
            responsePreview: (response.message.content ?? "").substring(0, 100),
            totalTokens: response.usage?.totalTokens,
            toolsUsed: response.toolsUsed ?? [],
            totalDurationMs: Date.now() - cronChatStart,
          });

          // Persist conversation history
          historyManager.addMessages(sessionKey, [
            { role: "user", content: prompt, timestamp: Date.now() },
            response.message,
          ]);

          // Deliver response to all connected channels
          if (response.message.content) {
            for (const ch of channelRegistry.list()) {
              try {
                await ch.sendMessage("default", {
                  content: response.message.content,
                });
              } catch {
                // Channel may not support default destination; skip
              }
            }
          }

          log.info(`agent_prompt job "${job.name}" completed for session ${sessionKey}`);
        } else {
          log.warn(`Unknown cron action: ${job.action}`);
        }
      });

      // Build WebSocket RPC method handlers
      const methods = new Map<string, import("./gateway/server-ws.js").MethodHandler>();
      {
        const { createChatSendHandler } = await import("./gateway/server-methods/chat.js");
        const { createSessionsListHandler, createSessionsCreateHandler, createSessionsDeleteHandler, createSessionsHistoryHandler } = await import("./gateway/server-methods/sessions.js");
        const { createChannelsListHandler, createChannelsStartHandler, createChannelsStopHandler } = await import("./gateway/server-methods/channels.js");
        const { createCronListHandler, createCronStatusHandler, createCronAddHandler, createCronRemoveHandler } = await import("./gateway/server-methods/cron.js");

        methods.set("chat.send", createChatSendHandler(agentRuntime, historyManager, {
          maxContextTokens: config.agent.maxContextTokens,
          systemPromptTokens: baseSystemPromptTokens,
          contextPruning: contextPruningSettings,
          summarizer: summarizerConfig,
        }));
        methods.set("sessions.list", createSessionsListHandler(sessionStore));
        methods.set("sessions.create", createSessionsCreateHandler(sessionStore));
        methods.set("sessions.delete", createSessionsDeleteHandler(sessionStore));
        methods.set("sessions.history", createSessionsHistoryHandler(sessionStore));
        methods.set("channels.list", createChannelsListHandler(channelDock));
        methods.set("channels.start", createChannelsStartHandler(channelDock));
        methods.set("channels.stop", createChannelsStopHandler(channelDock));
        methods.set("cron.list", createCronListHandler(cronService));
        methods.set("cron.status", createCronStatusHandler(cronService));
        methods.set("cron.add", createCronAddHandler(cronService));
        methods.set("cron.remove", createCronRemoveHandler(cronService));
      }

      // Create and start the gateway
      const gateway = createGateway({ config, methods });
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
        if (memoryManager) {
          memoryManager.close();
        }
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

// --- haya google ---
const googleCmd = program
  .command("google")
  .description("Manage Google OAuth authentication");

googleCmd
  .command("auth")
  .description("Authorize Haya to access your Google Calendar, Gmail, and Drive")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options: { config?: string }) => {
    const { loadConfig } = await import("./config/loader.js");
    const configPaths = [
      options.config,
      "haya.json",
      "haya.json5",
    ].filter(Boolean) as string[];

    let config;
    for (const p of configPaths) {
      try {
        config = await loadConfig(p);
        break;
      } catch {
        continue;
      }
    }

    if (!config?.tools?.google) {
      console.error("No Google configuration found in config file.");
      console.error("Add a tools.google section with clientIdEnvVar and clientSecretEnvVar.");
      process.exit(1);
    }

    const { GoogleAuth } = await import("./google/auth.js");
    const scopes: string[] = [];
    if (config.tools.google.calendar.enabled) {
      scopes.push("https://www.googleapis.com/auth/calendar.events");
    }
    if (config.tools.google.gmail.enabled) {
      scopes.push(
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
      );
    }
    if (config.tools.google.drive.enabled) {
      scopes.push(
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
      );
    }

    if (scopes.length === 0) {
      console.error("No Google services enabled. Enable calendar, gmail, or drive in config.");
      process.exit(1);
    }

    const googleAuth = new GoogleAuth({
      ...config.tools.google,
      scopes,
    });

    console.log("Starting Google OAuth authorization...");
    console.log(`Scopes: ${scopes.join(", ")}\n`);

    await googleAuth.authorize();
    console.log("\nAuthorization successful! Tokens saved.");
  });

googleCmd
  .command("revoke")
  .description("Revoke Google OAuth tokens")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options: { config?: string }) => {
    const { loadConfig } = await import("./config/loader.js");
    const configPaths = [
      options.config,
      "haya.json",
      "haya.json5",
    ].filter(Boolean) as string[];

    let config;
    for (const p of configPaths) {
      try {
        config = await loadConfig(p);
        break;
      } catch {
        continue;
      }
    }

    if (!config?.tools?.google) {
      console.error("No Google configuration found in config file.");
      process.exit(1);
    }

    const { GoogleAuth } = await import("./google/auth.js");
    const googleAuth = new GoogleAuth({
      ...config.tools.google,
      scopes: [],
    });

    await googleAuth.revokeTokens();
    console.log("Google OAuth tokens revoked and deleted.");
  });

program.parse();
