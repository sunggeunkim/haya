import type { AutoReplyStore } from "../channels/auto-reply-store.js";
import type { AutoReplyEngine } from "../channels/auto-reply.js";
import type { BuiltinTool } from "./builtin-tools.js";

/**
 * Create agent tools for managing auto-reply rules.
 */
export function createAutoReplyTools(
  store: AutoReplyStore,
  engine: AutoReplyEngine,
): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------
    // auto_reply_add
    // -----------------------------------------------------------------
    {
      name: "auto_reply_add",
      description:
        "Add an auto-reply rule. When an incoming message matches the regex pattern, " +
        "the specified reply is sent automatically. Use {{match}} in the reply to include the matched text.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to match against incoming messages",
          },
          reply: {
            type: "string",
            description: "Reply text to send. Use {{match}} to include the matched text.",
          },
          flags: {
            type: "string",
            description: 'Regex flags (default: "i" for case-insensitive)',
          },
          channels: {
            type: "array",
            items: { type: "string" },
            description: "Optional channel IDs to limit this rule to",
          },
          passthrough: {
            type: "boolean",
            description: "Whether to also forward the message to the AI (default: true)",
          },
        },
        required: ["pattern", "reply"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const pattern = args.pattern as string;
        const reply = args.reply as string;
        if (!pattern) throw new Error("pattern is required");
        if (!reply) throw new Error("reply is required");

        const flags = (args.flags as string) ?? "i";

        // Validate the regex
        try {
          new RegExp(pattern, flags);
        } catch (err) {
          throw new Error(
            `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const rule = store.add({
          pattern,
          reply,
          flags,
          channels: args.channels as string[] | undefined,
          passthrough: (args.passthrough as boolean) ?? true,
          enabled: true,
        });

        engine.addRule(rule);
        await store.save();

        return (
          `Auto-reply rule added:\n` +
          `  ID: ${rule.id}\n` +
          `  Pattern: /${rule.pattern}/${rule.flags}\n` +
          `  Reply: ${rule.reply}`
        );
      },
    },

    // -----------------------------------------------------------------
    // auto_reply_list
    // -----------------------------------------------------------------
    {
      name: "auto_reply_list",
      description: "List all auto-reply rules.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(): Promise<string> {
        const rules = store.list();
        if (rules.length === 0) {
          return "No auto-reply rules configured.";
        }

        const lines: string[] = [];
        for (const rule of rules) {
          const state = rule.enabled ? "enabled" : "disabled";
          const channels =
            rule.channels && rule.channels.length > 0
              ? ` [${rule.channels.join(", ")}]`
              : "";
          lines.push(`- ID: ${rule.id} [${state}]${channels}`);
          lines.push(`  Pattern: /${rule.pattern}/${rule.flags}`);
          lines.push(`  Reply: ${rule.reply}`);
          lines.push(`  Passthrough: ${rule.passthrough}`);
        }
        return lines.join("\n");
      },
    },

    // -----------------------------------------------------------------
    // auto_reply_remove
    // -----------------------------------------------------------------
    {
      name: "auto_reply_remove",
      description: "Remove an auto-reply rule by its ID.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The rule ID to remove",
          },
        },
        required: ["id"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const id = args.id as string;
        if (!id) throw new Error("id is required");

        const removed = store.remove(id);
        if (!removed) {
          return `Auto-reply rule ${id} not found.`;
        }

        engine.removeRule(id);
        await store.save();

        return `Auto-reply rule ${id} removed.`;
      },
    },
  ];
}
