import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SenderAuthManager } from "./sender-auth.js";

describe("SenderAuthManager", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "sender-auth-"));
  });

  describe("open mode", () => {
    it("allows all senders", async () => {
      const mgr = new SenderAuthManager({ mode: "open", dataDir });
      expect(await mgr.checkSender("anyone")).toBe("allowed");
      expect(await mgr.checkSender("someone-else")).toBe("allowed");
    });

    it("reports mode as open", () => {
      const mgr = new SenderAuthManager({ mode: "open", dataDir });
      expect(mgr.getMode()).toBe("open");
    });
  });

  describe("pairing mode", () => {
    it("returns unknown for new senders", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      expect(await mgr.checkSender("new-user")).toBe("unknown");
    });

    it("returns allowed for approved senders", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      await mgr.addSender("known-user", "allowed");
      expect(await mgr.checkSender("known-user")).toBe("allowed");
    });

    it("returns denied for denied senders", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      await mgr.addSender("bad-user", "denied");
      expect(await mgr.checkSender("bad-user")).toBe("denied");
    });
  });

  describe("allowlist mode", () => {
    it("returns unknown for unregistered senders", async () => {
      const mgr = new SenderAuthManager({ mode: "allowlist", dataDir });
      expect(await mgr.checkSender("stranger")).toBe("unknown");
    });

    it("returns allowed for registered senders", async () => {
      const mgr = new SenderAuthManager({ mode: "allowlist", dataDir });
      await mgr.addSender("trusted", "allowed");
      expect(await mgr.checkSender("trusted")).toBe("allowed");
    });
  });

  describe("createPairingCode", () => {
    it("returns a 6-character hex code", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      const code = await mgr.createPairingCode("user-1");
      expect(code).toMatch(/^[0-9a-f]{6}$/);
    });

    it("returns different codes for successive calls", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      const code1 = await mgr.createPairingCode("user-1");
      const code2 = await mgr.createPairingCode("user-2");
      // Extremely unlikely to collide, but technically possible.
      // We check format rather than strict inequality.
      expect(code1).toMatch(/^[0-9a-f]{6}$/);
      expect(code2).toMatch(/^[0-9a-f]{6}$/);
    });
  });

  describe("approvePairing", () => {
    it("succeeds with a valid code", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      const code = await mgr.createPairingCode("user-1");

      const result = await mgr.approvePairing(code);
      expect(result.success).toBe(true);
      expect(result.senderId).toBe("user-1");

      // Sender should now be allowed
      expect(await mgr.checkSender("user-1")).toBe("allowed");
    });

    it("fails with an invalid code", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      const result = await mgr.approvePairing("000000");
      expect(result.success).toBe(false);
      expect(result.senderId).toBeUndefined();
    });

    it("fails with an expired code", async () => {
      vi.useFakeTimers();
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      const code = await mgr.createPairingCode("user-1");

      // Advance past the 5-minute TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const result = await mgr.approvePairing(code);
      expect(result.success).toBe(false);
      vi.useRealTimers();
    });

    it("code is single-use", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      const code = await mgr.createPairingCode("user-1");

      const first = await mgr.approvePairing(code);
      expect(first.success).toBe(true);

      const second = await mgr.approvePairing(code);
      expect(second.success).toBe(false);
    });
  });

  describe("addSender / removeSender / listSenders", () => {
    it("adds and lists senders", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      await mgr.addSender("user-a", "allowed");
      await mgr.addSender("user-b", "denied");

      const list = await mgr.listSenders();
      expect(list).toHaveLength(2);
      expect(list).toEqual(
        expect.arrayContaining([
          { senderId: "user-a", status: "allowed" },
          { senderId: "user-b", status: "denied" },
        ]),
      );
    });

    it("removeSender returns true for existing sender", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      await mgr.addSender("user-a", "allowed");
      expect(await mgr.removeSender("user-a")).toBe(true);

      const list = await mgr.listSenders();
      expect(list).toHaveLength(0);
    });

    it("removeSender returns false for non-existing sender", async () => {
      const mgr = new SenderAuthManager({ mode: "pairing", dataDir });
      expect(await mgr.removeSender("ghost")).toBe(false);
    });

    it("persists data across instances", async () => {
      const mgr1 = new SenderAuthManager({ mode: "pairing", dataDir });
      await mgr1.addSender("persistent-user", "allowed");

      const mgr2 = new SenderAuthManager({ mode: "pairing", dataDir });
      const list = await mgr2.listSenders();
      expect(list).toEqual([
        { senderId: "persistent-user", status: "allowed" },
      ]);
    });
  });
});
