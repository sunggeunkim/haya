/**
 * Sender authentication manager with open / pairing / allowlist modes.
 * Part of Phase 1 security hardening.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import crypto from "node:crypto";

export type SenderAuthMode = "open" | "pairing" | "allowlist";

export type SenderStatus = "allowed" | "pending" | "denied" | "unknown";

export interface PairingCode {
  code: string;
  senderId: string;
  createdAt: number;
  expiresAt: number;
}

const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Manages sender identity verification with three modes:
 *
 * - **open**      – every sender is implicitly allowed.
 * - **pairing**   – unknown senders must complete a pairing handshake.
 * - **allowlist** – only explicitly registered senders are allowed.
 */
export class SenderAuthManager {
  private readonly mode: SenderAuthMode;
  private readonly sendersPath: string;
  private readonly pairingCodesPath: string;

  constructor(opts: { mode: SenderAuthMode; dataDir: string }) {
    this.mode = opts.mode;
    this.sendersPath = join(opts.dataDir, "senders.json");
    this.pairingCodesPath = join(opts.dataDir, "pairing-codes.json");
  }

  getMode(): SenderAuthMode {
    return this.mode;
  }

  /**
   * Determine the status of a sender under the current mode.
   */
  async checkSender(senderId: string): Promise<SenderStatus> {
    if (this.mode === "open") {
      return "allowed";
    }

    const senders = await this.loadSenders();
    const status = senders.get(senderId);
    if (status) {
      return status as SenderStatus;
    }
    return "unknown";
  }

  /**
   * Generate a single-use, time-limited pairing code for a sender.
   * Returns the 6-character hex code.
   */
  async createPairingCode(senderId: string): Promise<string> {
    const code = crypto.randomBytes(3).toString("hex");
    const now = Date.now();
    const pairingCode: PairingCode = {
      code,
      senderId,
      createdAt: now,
      expiresAt: now + PAIRING_TTL_MS,
    };

    const codes = await this.loadPairingCodes();
    codes.push(pairingCode);
    await this.savePairingCodes(codes);

    return code;
  }

  /**
   * Approve a pairing by validating the supplied code.
   * On success the sender is added to the allowed list and the code is consumed.
   */
  async approvePairing(
    code: string,
  ): Promise<{ success: boolean; senderId?: string }> {
    const codes = await this.loadPairingCodes();
    const cleaned = this.cleanExpiredCodes(codes);

    const idx = cleaned.findIndex((c) => c.code === code);
    if (idx === -1) {
      return { success: false };
    }

    const pairingCode = cleaned[idx];
    cleaned.splice(idx, 1);
    await this.savePairingCodes(cleaned);

    await this.addSender(pairingCode.senderId, "allowed");

    return { success: true, senderId: pairingCode.senderId };
  }

  /**
   * Explicitly register a sender with a given status.
   */
  async addSender(
    senderId: string,
    status: "allowed" | "denied",
  ): Promise<void> {
    const senders = await this.loadSenders();
    senders.set(senderId, status);
    await this.saveSenders(senders);
  }

  /**
   * Remove a sender from the registry.
   * Returns true if the sender existed.
   */
  async removeSender(senderId: string): Promise<boolean> {
    const senders = await this.loadSenders();
    const existed = senders.delete(senderId);
    if (existed) {
      await this.saveSenders(senders);
    }
    return existed;
  }

  /**
   * List all registered senders.
   */
  async listSenders(): Promise<Array<{ senderId: string; status: string }>> {
    const senders = await this.loadSenders();
    return Array.from(senders.entries()).map(([senderId, status]) => ({
      senderId,
      status,
    }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async loadSenders(): Promise<Map<string, string>> {
    try {
      const raw = await readFile(this.sendersPath, "utf-8");
      const entries: Array<[string, string]> = JSON.parse(raw);
      return new Map(entries);
    } catch {
      return new Map();
    }
  }

  private async saveSenders(senders: Map<string, string>): Promise<void> {
    const data = JSON.stringify(Array.from(senders.entries()), null, 2);
    await mkdir(dirname(this.sendersPath), { recursive: true });
    await writeFile(this.sendersPath, data, { mode: 0o600 });
  }

  private async loadPairingCodes(): Promise<PairingCode[]> {
    try {
      const raw = await readFile(this.pairingCodesPath, "utf-8");
      return JSON.parse(raw) as PairingCode[];
    } catch {
      return [];
    }
  }

  private async savePairingCodes(codes: PairingCode[]): Promise<void> {
    const data = JSON.stringify(codes, null, 2);
    await mkdir(dirname(this.pairingCodesPath), { recursive: true });
    await writeFile(this.pairingCodesPath, data, { mode: 0o600 });
  }

  private cleanExpiredCodes(codes: PairingCode[]): PairingCode[] {
    const now = Date.now();
    return codes.filter((c) => c.expiresAt > now);
  }
}
