import { describe, expect, it } from "vitest";
import { buildCspHeader, generateCspNonce } from "./csp.js";

describe("generateCspNonce", () => {
  it("generates a base64 string", () => {
    const nonce = generateCspNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
    // Should be valid base64
    expect(Buffer.from(nonce, "base64").toString("base64")).toBe(nonce);
  });

  it("generates unique nonces", () => {
    const nonces = new Set(Array.from({ length: 20 }, () => generateCspNonce()));
    expect(nonces.size).toBe(20);
  });
});

describe("buildCspHeader", () => {
  it("includes the nonce in script-src and style-src", () => {
    const nonce = "test-nonce-123";
    const header = buildCspHeader(nonce);
    expect(header).toContain(`'nonce-${nonce}'`);
    expect(header).toContain("script-src 'self' 'nonce-test-nonce-123'");
    expect(header).toContain("style-src 'self' 'nonce-test-nonce-123'");
  });

  it("only allows wss: (not ws:) in connect-src", () => {
    const header = buildCspHeader("nonce");
    expect(header).toContain("connect-src 'self' wss:");
    expect(header).not.toMatch(/connect-src[^;]*\bws:/);
  });

  it("does not include unsafe-inline", () => {
    const header = buildCspHeader("nonce");
    expect(header).not.toContain("unsafe-inline");
  });

  it("blocks framing", () => {
    const header = buildCspHeader("nonce");
    expect(header).toContain("frame-ancestors 'none'");
  });

  it("blocks object/embed", () => {
    const header = buildCspHeader("nonce");
    expect(header).toContain("object-src 'none'");
  });

  it("blocks base URI manipulation", () => {
    const header = buildCspHeader("nonce");
    expect(header).toContain("base-uri 'none'");
  });
});
