import { describe, expect, it, vi } from "vitest";
import {
  ToolPolicyEngine,
  type ToolPolicy,
  type ApprovalCallback,
} from "./tool-policy.js";

describe("ToolPolicyEngine", () => {
  it("defaults to 'allow' for unknown tools", () => {
    const engine = new ToolPolicyEngine([]);
    expect(engine.getPolicy("anything")).toBe("allow");
  });

  it("returns the configured policy level", () => {
    const engine = new ToolPolicyEngine([
      { toolName: "shell", level: "deny" },
      { toolName: "read_file", level: "confirm" },
    ]);
    expect(engine.getPolicy("shell")).toBe("deny");
    expect(engine.getPolicy("read_file")).toBe("confirm");
  });

  describe("checkPolicy", () => {
    it("allows when policy is 'allow'", async () => {
      const engine = new ToolPolicyEngine([]);
      const result = await engine.checkPolicy("any_tool", {});
      expect(result).toEqual({ allowed: true });
    });

    it("denies when policy is 'deny'", async () => {
      const engine = new ToolPolicyEngine([
        { toolName: "shell", level: "deny" },
      ]);
      const result = await engine.checkPolicy("shell", { cmd: "rm -rf" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Tool denied by policy");
    });

    it("allows 'confirm' when approval callback returns true", async () => {
      const cb: ApprovalCallback = vi.fn().mockResolvedValue(true);
      const engine = new ToolPolicyEngine(
        [{ toolName: "deploy", level: "confirm" }],
        cb,
      );
      const result = await engine.checkPolicy("deploy", { env: "prod" });
      expect(result.allowed).toBe(true);
      expect(cb).toHaveBeenCalledWith("deploy", { env: "prod" });
    });

    it("denies 'confirm' when approval callback returns false", async () => {
      const cb: ApprovalCallback = vi.fn().mockResolvedValue(false);
      const engine = new ToolPolicyEngine(
        [{ toolName: "deploy", level: "confirm" }],
        cb,
      );
      const result = await engine.checkPolicy("deploy", {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Tool denied by policy");
    });

    it("denies 'confirm' when no approval callback is set", async () => {
      const engine = new ToolPolicyEngine([
        { toolName: "deploy", level: "confirm" },
      ]);
      const result = await engine.checkPolicy("deploy", {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Tool denied by policy");
    });

    it("denies 'confirm' on approval timeout", async () => {
      vi.useFakeTimers();
      const cb: ApprovalCallback = () =>
        new Promise(() => {
          /* never resolves */
        });
      const engine = new ToolPolicyEngine(
        [{ toolName: "deploy", level: "confirm" }],
        cb,
      );

      const promise = engine.checkPolicy("deploy", {});
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await promise;

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Approval timed out");
      vi.useRealTimers();
    });
  });

  describe("setApprovalCallback", () => {
    it("replaces the approval callback", async () => {
      const engine = new ToolPolicyEngine([
        { toolName: "deploy", level: "confirm" },
      ]);

      // No callback → denied
      let result = await engine.checkPolicy("deploy", {});
      expect(result.allowed).toBe(false);

      // Set callback → approved
      engine.setApprovalCallback(vi.fn().mockResolvedValue(true));
      result = await engine.checkPolicy("deploy", {});
      expect(result.allowed).toBe(true);
    });
  });

  describe("addPolicy / removePolicy", () => {
    it("adds a new policy", () => {
      const engine = new ToolPolicyEngine([]);
      engine.addPolicy({ toolName: "shell", level: "deny" });
      expect(engine.getPolicy("shell")).toBe("deny");
    });

    it("overwrites an existing policy", () => {
      const engine = new ToolPolicyEngine([
        { toolName: "shell", level: "deny" },
      ]);
      engine.addPolicy({ toolName: "shell", level: "allow" });
      expect(engine.getPolicy("shell")).toBe("allow");
    });

    it("removes a policy and returns true", () => {
      const engine = new ToolPolicyEngine([
        { toolName: "shell", level: "deny" },
      ]);
      expect(engine.removePolicy("shell")).toBe(true);
      expect(engine.getPolicy("shell")).toBe("allow");
    });

    it("returns false when removing a non-existent policy", () => {
      const engine = new ToolPolicyEngine([]);
      expect(engine.removePolicy("nope")).toBe(false);
    });
  });

  describe("listPolicies", () => {
    it("returns all registered policies", () => {
      const policies: ToolPolicy[] = [
        { toolName: "shell", level: "deny" },
        { toolName: "read_file", level: "confirm" },
        { toolName: "write_file", level: "allow" },
      ];
      const engine = new ToolPolicyEngine(policies);
      const list = engine.listPolicies();
      expect(list).toHaveLength(3);
      expect(list).toEqual(expect.arrayContaining(policies));
    });

    it("returns empty array when no policies exist", () => {
      const engine = new ToolPolicyEngine([]);
      expect(engine.listPolicies()).toEqual([]);
    });
  });
});
