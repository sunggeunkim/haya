import type { ChannelRegistry } from "../channels/registry.js";
import type { CronService } from "../cron/service.js";
import type { AssistantConfig } from "../config/types.js";
import type { BuiltinTool } from "./builtin-tools.js";

export interface GatewayToolContext {
  config: AssistantConfig;
  uptime: () => number;
  channelRegistry: ChannelRegistry;
  cronService: CronService;
}

/**
 * Create agent tools for inspecting gateway status and configuration.
 */
export function createGatewayTools(ctx: GatewayToolContext): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------
    // gateway_status
    // -----------------------------------------------------------------
    {
      name: "gateway_status",
      description:
        "Get the current status of the Haya gateway including uptime, " +
        "connected channels, active cron jobs, provider, and model.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const uptimeMs = ctx.uptime();
        const uptimeSec = Math.floor(uptimeMs / 1000);
        const hours = Math.floor(uptimeSec / 3600);
        const minutes = Math.floor((uptimeSec % 3600) / 60);
        const seconds = uptimeSec % 60;

        const channels = ctx.channelRegistry.list();
        const channelLines = channels.map((ch) => {
          const s = ch.status();
          return `  - ${ch.id} (${ch.name}): ${s.connected ? "connected" : "disconnected"}`;
        });

        const jobs = ctx.cronService.listJobs();
        const activeJobs = jobs.filter((j) => j.enabled);

        const lines: string[] = [
          `Uptime: ${hours}h ${minutes}m ${seconds}s`,
          `Provider: ${ctx.config.agent.defaultProvider}`,
          `Model: ${ctx.config.agent.defaultModel}`,
          `Port: ${ctx.config.gateway.port}`,
          "",
          `Channels (${channels.length}):`,
          ...(channelLines.length > 0 ? channelLines : ["  (none)"]),
          "",
          `Cron jobs: ${activeJobs.length} active / ${jobs.length} total`,
        ];

        return lines.join("\n");
      },
    },

    // -----------------------------------------------------------------
    // gateway_config
    // -----------------------------------------------------------------
    {
      name: "gateway_config",
      description:
        "Get the current gateway configuration with secrets redacted.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const { redactSensitive } = await import("../infra/logger.js");
        const redacted = redactSensitive(ctx.config);
        const json = JSON.stringify(redacted, null, 2);
        const MAX_LENGTH = 16_000;
        if (json.length > MAX_LENGTH) {
          return `${json.slice(0, MAX_LENGTH)}\n\n[Truncated — ${json.length} chars total]`;
        }
        return json;
      },
    },
  ];
}
