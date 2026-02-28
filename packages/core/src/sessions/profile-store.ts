import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Per-sender profile store — one JSON file per sender at `<dataDir>/<safe-sender-id>.json`.
 * Stores simple key-value pairs (name, location, preferences, etc.).
 */
export class SenderProfileStore {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * Load the full profile for a sender.  Returns an empty object when no
   * profile file exists yet.
   */
  async load(senderId: string): Promise<Record<string, string>> {
    const filePath = this.profilePath(senderId);
    if (!existsSync(filePath)) {
      return {};
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  }

  /**
   * Persist a full profile for a sender.
   */
  async save(senderId: string, profile: Record<string, string>): Promise<void> {
    this.ensureDir();
    const filePath = this.profilePath(senderId);
    writeFileSync(filePath, JSON.stringify(profile, null, 2) + "\n", {
      mode: 0o600,
    });
  }

  /**
   * Get a single profile value.
   */
  async get(senderId: string, key: string): Promise<string | undefined> {
    const profile = await this.load(senderId);
    return profile[key];
  }

  /**
   * Set a single profile value (creates or updates).
   */
  async set(senderId: string, key: string, value: string): Promise<void> {
    const profile = await this.load(senderId);
    profile[key] = value;
    await this.save(senderId, profile);
  }

  /**
   * Delete a single profile key. Returns true if the key existed.
   */
  async delete(senderId: string, key: string): Promise<boolean> {
    const profile = await this.load(senderId);
    if (!(key in profile)) return false;
    delete profile[key];
    await this.save(senderId, profile);
    return true;
  }

  /**
   * List all stored facts for a sender.
   */
  async list(senderId: string): Promise<Record<string, string>> {
    return this.load(senderId);
  }

  /**
   * Format a profile as text suitable for injection into the system prompt.
   */
  formatForPrompt(profile: Record<string, string>): string {
    const entries = Object.entries(profile);
    if (entries.length === 0) return "";
    const lines = entries.map(([k, v]) => `- ${k}: ${v}`);
    return `[User Profile]\n${lines.join("\n")}`;
  }

  /**
   * Sanitize a sender ID for use as a filename.
   * Replaces any non-alphanumeric characters (except hyphens/underscores) with `-`.
   */
  sanitizeId(senderId: string): string {
    const safe = senderId.replace(/[^a-zA-Z0-9_-]/g, "-");
    if (safe.length === 0) {
      throw new Error(`Invalid sender ID: ${senderId}`);
    }
    return safe;
  }

  private profilePath(senderId: string): string {
    const safe = this.sanitizeId(senderId);
    return join(this.dataDir, `${safe}.json`);
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    }
  }
}
