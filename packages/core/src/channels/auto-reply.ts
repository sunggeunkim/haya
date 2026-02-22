import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema & types
// ---------------------------------------------------------------------------

export const AutoReplyRuleSchema = z.object({
  /** Unique ID for this rule */
  id: z.string(),
  /** Pattern to match against incoming message content (regex string) */
  pattern: z.string(),
  /** Flags for the regex (default: "i" for case-insensitive) */
  flags: z.string().default("i"),
  /** The reply to send */
  reply: z.string(),
  /** Whether to also forward the message to the AI (default: true) */
  passthrough: z.boolean().default(true),
  /** Whether this rule is enabled */
  enabled: z.boolean().default(true),
  /** Optional: only apply to specific channels */
  channels: z.array(z.string()).optional(),
});

export type AutoReplyRule = z.infer<typeof AutoReplyRuleSchema>;

export interface AutoReplyMatch {
  rule: AutoReplyRule;
  reply: string;
  passthrough: boolean;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class AutoReplyEngine {
  private rules: AutoReplyRule[] = [];

  constructor(rules?: AutoReplyRule[]) {
    if (rules) {
      this.rules = [...rules];
    }
  }

  /** Add a rule */
  addRule(rule: AutoReplyRule): void {
    this.rules.push(rule);
  }

  /** Remove a rule by ID */
  removeRule(id: string): boolean {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) return false;
    this.rules.splice(index, 1);
    return true;
  }

  /** Get all rules */
  listRules(): AutoReplyRule[] {
    return [...this.rules];
  }

  /**
   * Check a message against all rules.
   * Returns all matching auto-replies.
   */
  check(content: string, channel?: string): AutoReplyMatch[] {
    const matches: AutoReplyMatch[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      // Channel filtering
      if (rule.channels && rule.channels.length > 0 && channel) {
        if (!rule.channels.includes(channel)) continue;
      }
      if (rule.channels && rule.channels.length > 0 && !channel) {
        continue;
      }

      let regex: RegExp;
      try {
        regex = new RegExp(rule.pattern, rule.flags);
      } catch {
        // Skip rules with invalid regex patterns
        continue;
      }

      const match = regex.exec(content);
      if (!match) continue;

      const reply = this.applyTemplate(rule.reply, match[0], channel);
      matches.push({
        rule,
        reply,
        passthrough: rule.passthrough,
      });
    }

    return matches;
  }

  /**
   * Whether the message should be forwarded to the AI.
   * Returns false only if ALL matching rules have passthrough=false.
   * Returns true if no rules match or any matching rule has passthrough=true.
   */
  shouldForwardToAI(content: string, channel?: string): boolean {
    const matches = this.check(content, channel);
    if (matches.length === 0) return true;
    return matches.some((m) => m.passthrough);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private applyTemplate(
    template: string,
    matchedText: string,
    channel?: string,
  ): string {
    let result = template;
    result = result.replace(/\{\{match\}\}/g, matchedText);
    result = result.replace(/\{\{channel\}\}/g, channel ?? "");
    return result;
  }
}
