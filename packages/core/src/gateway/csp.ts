import { randomBytes } from "node:crypto";

/**
 * Nonce-based Content Security Policy. Fixes MED-1 (no unsafe-inline)
 * and MED-2 (wss: only, no ws:).
 */

/**
 * Generate a cryptographically random CSP nonce.
 */
export function generateCspNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Build the Content-Security-Policy header value.
 * Uses a per-request nonce for script and style sources.
 * Only allows encrypted WebSocket (wss:), not plaintext ws:.
 */
export function buildCspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' wss:",
  ].join("; ");
}

/**
 * Build a CSP header for the web chat page.
 * Allows both ws: and wss: in connect-src since the chat UI may
 * connect over plaintext WebSocket on loopback without TLS.
 */
export function buildWebChatCspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
  ].join("; ");
}
