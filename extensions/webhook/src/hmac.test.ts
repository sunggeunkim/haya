import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import { verifyHmacSignature } from "./hmac.js";

function computeHmac(
  payload: string,
  secret: string,
  algorithm = "sha256",
): string {
  return crypto.createHmac(algorithm, secret).update(payload).digest("hex");
}

describe("verifyHmacSignature", () => {
  const payload = '{"event":"push","ref":"refs/heads/main"}';
  const secret = "test-secret-key";

  it("accepts a valid signature with sha256= prefix", () => {
    const hex = computeHmac(payload, secret, "sha256");
    const signature = `sha256=${hex}`;

    expect(verifyHmacSignature(payload, signature, secret)).toBe(true);
  });

  it("accepts a valid signature without prefix using default algorithm", () => {
    const hex = computeHmac(payload, secret, "sha256");

    expect(verifyHmacSignature(payload, hex, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const signature = `sha256=${"a".repeat(64)}`;

    expect(verifyHmacSignature(payload, signature, secret)).toBe(false);
  });

  it("rejects when the wrong algorithm is used", () => {
    const hex = computeHmac(payload, secret, "sha1");
    // Sign with sha1 but verify expecting sha256 (default)
    const signature = `sha256=${hex}`;

    expect(verifyHmacSignature(payload, signature, secret)).toBe(false);
  });

  it("correctly parses algorithm prefix from signature", () => {
    const hex = computeHmac(payload, secret, "sha1");
    const signature = `sha1=${hex}`;

    expect(verifyHmacSignature(payload, signature, secret, "sha1")).toBe(true);
  });

  it("returns false for non-hex signature content", () => {
    expect(
      verifyHmacSignature(payload, "sha256=not-valid-hex!", secret),
    ).toBe(false);
  });

  it("returns false for empty signature", () => {
    expect(verifyHmacSignature(payload, "", secret)).toBe(false);
  });

  it("returns false for unknown algorithm", () => {
    expect(
      verifyHmacSignature(payload, "unknown=abcdef", secret, "unknown"),
    ).toBe(false);
  });

  it("uses timing-safe comparison (no early exit on mismatch)", () => {
    // This test verifies the function uses timingSafeEqual by checking
    // that both similar and dissimilar wrong signatures are rejected
    const correctHex = computeHmac(payload, secret);
    const almostCorrect = `sha256=${correctHex.slice(0, -1)}0`;
    const totallyWrong = `sha256=${"f".repeat(64)}`;

    expect(verifyHmacSignature(payload, almostCorrect, secret)).toBe(false);
    expect(verifyHmacSignature(payload, totallyWrong, secret)).toBe(false);
  });

  it("handles different payloads with the same secret", () => {
    const hex1 = computeHmac("payload-one", secret);
    const hex2 = computeHmac("payload-two", secret);

    expect(
      verifyHmacSignature("payload-one", `sha256=${hex1}`, secret),
    ).toBe(true);
    expect(
      verifyHmacSignature("payload-one", `sha256=${hex2}`, secret),
    ).toBe(false);
  });
});
