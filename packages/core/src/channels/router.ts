import type { InboundMessage } from "./types.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("message-router");

export type GroupChatMode = "all" | "mentions" | "commands";

export interface MessageRouterConfig {
  groupChatMode: GroupChatMode;
  commandPrefix: string;
  botNames: string[];
}

/**
 * Filters messages in group chats. DMs are always processed.
 * Group messages are filtered based on mode:
 * - "all": process every message
 * - "mentions": only process @mentions of the bot
 * - "commands": only process messages starting with command prefix
 */
export class MessageRouter {
  private readonly config: MessageRouterConfig;

  constructor(config?: Partial<MessageRouterConfig>) {
    this.config = {
      groupChatMode: config?.groupChatMode ?? "mentions",
      commandPrefix: config?.commandPrefix ?? "/haya",
      botNames: config?.botNames ?? [],
    };
  }

  /**
   * Determine if a message should be processed.
   * Returns the cleaned message content (with mention/prefix stripped) or null to skip.
   */
  shouldProcess(msg: InboundMessage): {
    process: boolean;
    cleanedContent?: string;
  } {
    const channelType = msg.metadata?.channelType as string | undefined;
    const isDm =
      channelType === "im" ||
      channelType === "personal" ||
      channelType === "private";

    // Always process DMs
    if (isDm) {
      return { process: true, cleanedContent: msg.content };
    }

    // Group chat filtering
    switch (this.config.groupChatMode) {
      case "all":
        return { process: true, cleanedContent: msg.content };

      case "mentions": {
        const mentioned = this.detectMention(msg.content);
        if (mentioned) {
          return { process: true, cleanedContent: mentioned.cleanedContent };
        }
        // Also check metadata for bot mention
        if (msg.metadata?.botMentioned) {
          return { process: true, cleanedContent: msg.content };
        }
        return { process: false };
      }

      case "commands": {
        if (msg.content.trimStart().startsWith(this.config.commandPrefix)) {
          const cleanedContent = msg.content
            .trimStart()
            .slice(this.config.commandPrefix.length)
            .trim();
          return { process: true, cleanedContent };
        }
        return { process: false };
      }

      default:
        return { process: false };
    }
  }

  private detectMention(
    content: string,
  ): { cleanedContent: string } | null {
    for (const name of this.config.botNames) {
      const mentionPattern = new RegExp(`@${name}\\b`, "i");
      if (mentionPattern.test(content)) {
        const cleanedContent = content.replace(mentionPattern, "").trim();
        return { cleanedContent };
      }
    }

    return null;
  }
}
