/**
 * Tool policy engine for controlling tool execution with allow/confirm/deny levels.
 * Part of Phase 1 security hardening.
 */

export type PolicyLevel = "allow" | "confirm" | "deny";

export interface ToolPolicy {
  toolName: string;
  level: PolicyLevel;
}

export type ApprovalCallback = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

const APPROVAL_TIMEOUT_MS = 120_000;

/**
 * Enforces per-tool execution policies.
 * Tools can be allowed unconditionally, denied, or gated behind a human-in-the-loop
 * confirmation callback with a 120-second timeout.
 */
export class ToolPolicyEngine {
  private readonly policies: Map<string, PolicyLevel>;
  private approvalCallback?: ApprovalCallback;

  constructor(policies: ToolPolicy[], approvalCallback?: ApprovalCallback) {
    this.policies = new Map(policies.map((p) => [p.toolName, p.level]));
    this.approvalCallback = approvalCallback;
  }

  /**
   * Register (or replace) the human-in-the-loop approval callback.
   */
  setApprovalCallback(cb: ApprovalCallback): void {
    this.approvalCallback = cb;
  }

  /**
   * Return the policy level for a given tool. Defaults to "allow" when
   * no explicit policy has been registered.
   */
  getPolicy(toolName: string): PolicyLevel {
    return this.policies.get(toolName) ?? "allow";
  }

  /**
   * Evaluate the policy for a tool invocation.
   *
   * - "allow"   -> immediately permitted
   * - "deny"    -> immediately rejected
   * - "confirm" -> delegates to the approval callback (120 s timeout)
   */
  async checkPolicy(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const level = this.getPolicy(toolName);

    if (level === "allow") {
      return { allowed: true };
    }

    if (level === "deny") {
      return { allowed: false, reason: "Tool denied by policy" };
    }

    // level === "confirm"
    if (!this.approvalCallback) {
      return { allowed: false, reason: "Tool denied by policy" };
    }

    try {
      const approved = await Promise.race<boolean>([
        this.approvalCallback(toolName, args),
        new Promise<boolean>((_, reject) =>
          setTimeout(
            () => reject(new Error("Approval timed out")),
            APPROVAL_TIMEOUT_MS,
          ),
        ),
      ]);

      if (approved) {
        return { allowed: true };
      }
      return { allowed: false, reason: "Tool denied by policy" };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "Approval timed out") {
        return { allowed: false, reason: "Approval timed out" };
      }
      return { allowed: false, reason: "Tool denied by policy" };
    }
  }

  /**
   * Add or update a policy for a tool.
   */
  addPolicy(policy: ToolPolicy): void {
    this.policies.set(policy.toolName, policy.level);
  }

  /**
   * Remove the policy for a tool. Returns true if a policy was removed.
   */
  removePolicy(toolName: string): boolean {
    return this.policies.delete(toolName);
  }

  /**
   * Return a snapshot of all registered policies.
   */
  listPolicies(): ToolPolicy[] {
    return Array.from(this.policies.entries()).map(([toolName, level]) => ({
      toolName,
      level,
    }));
  }

  /**
   * Hot-reload: replace all policies with a new set.
   * Clears existing policies and sets the provided ones.
   */
  replaceAllPolicies(policies: ToolPolicy[]): void {
    this.policies.clear();
    for (const p of policies) {
      this.policies.set(p.toolName, p.level);
    }
  }
}
