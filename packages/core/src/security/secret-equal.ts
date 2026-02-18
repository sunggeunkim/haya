import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison using SHA-256 hash padding.
 * Both inputs are hashed to fixed 32-byte digests before comparison,
 * preventing length-based timing side-channels (fixes HIGH-1).
 */
export function safeEqualSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }

  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}
