import * as crypto from "node:crypto";

/**
 * Verify an HMAC signature against a payload.
 *
 * Signature format: `<algorithm>=<hex-digest>` (e.g. `sha256=abc123...`)
 * If no prefix is present, the default algorithm is used.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm = "sha256",
): boolean {
  // Parse the signature format: "algo=hex"
  let algo = algorithm;
  let sigHex = signature;

  const eqIndex = signature.indexOf("=");
  if (eqIndex !== -1) {
    const prefix = signature.slice(0, eqIndex);
    const rest = signature.slice(eqIndex + 1);
    // Only treat as algorithm prefix if it looks like a hash name (letters/digits only)
    if (/^[a-z0-9]+$/i.test(prefix) && rest.length > 0) {
      algo = prefix;
      sigHex = rest;
    }
  }

  // Validate hex string
  if (!/^[a-f0-9]+$/i.test(sigHex)) {
    return false;
  }

  let expected: Buffer;
  try {
    expected = Buffer.from(
      crypto.createHmac(algo, secret).update(payload).digest("hex"),
      "utf-8",
    );
  } catch {
    // Unknown algorithm
    return false;
  }

  const provided = Buffer.from(sigHex, "utf-8");

  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}
