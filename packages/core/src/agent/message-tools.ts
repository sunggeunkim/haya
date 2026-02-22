import type { ChannelRegistry } from "../channels/registry.js";
import type { BuiltinTool } from "./builtin-tools.js";

/**
 * Create agent tools for sending messages across channels.
 */
export function createMessageTools(
  channelRegistry: ChannelRegistry,
): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------
    // message_send
    // -----------------------------------------------------------------
    {
      name: "message_send",
      description:
        "Send a message to a specific channel and destination. " +
        "Use channels_list to discover available channels first.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: 'Channel plugin ID (e.g., "slack", "discord", "telegram")',
          },
          channelId: {
            type: "string",
            description: "Target chat/room/channel ID within the platform",
          },
          content: {
            type: "string",
            description: "Message content to send",
          },
          threadId: {
            type: "string",
            description: "Optional thread ID to reply in a thread",
          },
        },
        required: ["channel", "channelId", "content"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const channel = args.channel as string;
        const targetId = args.channelId as string;
        const content = args.content as string;
        const threadId = args.threadId as string | undefined;

        if (!channel) throw new Error("channel is required");
        if (!targetId) throw new Error("channelId is required");
        if (!content) throw new Error("content is required");

        const plugin = channelRegistry.get(channel);
        if (!plugin) {
          throw new Error(
            `Channel "${channel}" not found. Use channels_list to see available channels.`,
          );
        }

        await plugin.sendMessage(targetId, { content, threadId });
        return `Message sent to ${channel}:${targetId}`;
      },
    },

    // -----------------------------------------------------------------
    // message_broadcast
    // -----------------------------------------------------------------
    {
      name: "message_broadcast",
      description:
        "Send a message to all connected channels. Each channel receives the message " +
        "on its default destination.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Message content to broadcast",
          },
        },
        required: ["content"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const content = args.content as string;
        if (!content) throw new Error("content is required");

        const channels = channelRegistry.list();
        if (channels.length === 0) {
          return "No channels connected. Nothing to broadcast.";
        }

        const results: string[] = [];
        for (const ch of channels) {
          try {
            await ch.sendMessage("default", { content });
            results.push(`${ch.id}: sent`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push(`${ch.id}: failed (${msg})`);
          }
        }
        return `Broadcast results:\n${results.join("\n")}`;
      },
    },

    // -----------------------------------------------------------------
    // channels_list
    // -----------------------------------------------------------------
    {
      name: "channels_list",
      description: "List all registered channels and their connection status.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const channels = channelRegistry.list();
        if (channels.length === 0) {
          return "No channels registered.";
        }

        const lines: string[] = [];
        for (const ch of channels) {
          const status = ch.status();
          const state = status.connected ? "connected" : "disconnected";
          lines.push(`- ${ch.id} (${ch.name}): ${state}`);
        }
        return lines.join("\n");
      },
    },
  ];
}
