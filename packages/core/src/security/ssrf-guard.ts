/**
 * SSRF prevention utilities.
 * Blocks requests to private/internal IP ranges by resolving hostnames
 * and checking against known private CIDR blocks.
 */

import { lookup } from "node:dns/promises";
import { ipMatchesCIDR } from "../gateway/net.js";

/** Private IPv4 CIDR blocks to block. */
const PRIVATE_IPV4_RANGES = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "0.0.0.0/8",
];

/** Blocked IPv6 addresses (exact match). */
const BLOCKED_IPV6 = ["::1"];

/** IPv6 prefixes to block (fc00::/7 = fd + fc). */
const BLOCKED_IPV6_PREFIXES = ["fc", "fd"];

/**
 * Error thrown when a URL targets a private/internal network address.
 */
export class SsrfViolationError extends Error {
  readonly hostname: string;
  readonly resolvedIp?: string;

  constructor(hostname: string, resolvedIp?: string) {
    const msg = resolvedIp
      ? `SSRF blocked: ${hostname} resolves to private IP ${resolvedIp}`
      : `SSRF blocked: ${hostname} is a private/local address`;
    super(msg);
    this.name = "SsrfViolationError";
    this.hostname = hostname;
    this.resolvedIp = resolvedIp;
  }
}

/**
 * Fast pre-check for obviously private hostnames.
 * Returns `true` if the hostname should be blocked without DNS resolution.
 */
export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // localhost variants
  if (lower === "localhost" || lower === "localhost.") return true;

  // .local mDNS domain
  if (lower.endsWith(".local") || lower.endsWith(".local.")) return true;

  // Raw IPv4 private addresses
  for (const cidr of PRIVATE_IPV4_RANGES) {
    if (ipMatchesCIDR(lower, cidr)) return true;
  }

  // Raw IPv6 loopback and private
  if (lower === "::1" || lower === "[::1]") return true;
  const stripped = lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;
  for (const prefix of BLOCKED_IPV6_PREFIXES) {
    if (stripped.startsWith(prefix)) return true;
  }

  return false;
}

/**
 * Check whether a resolved IP address is in a private range.
 */
function isPrivateIp(ip: string, family: 4 | 6): boolean {
  if (family === 4) {
    return PRIVATE_IPV4_RANGES.some((cidr) => ipMatchesCIDR(ip, cidr));
  }

  // IPv6
  if (ip === "::1") return true;
  const lower = ip.toLowerCase();
  for (const prefix of BLOCKED_IPV6_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    return PRIVATE_IPV4_RANGES.some((cidr) => ipMatchesCIDR(v4, cidr));
  }

  return false;
}

/**
 * Assert that a URL does not point to a private/internal network address.
 * Resolves the hostname via DNS and checks the result against blocked ranges.
 *
 * @throws {SsrfViolationError} if the URL targets a private address
 */
export async function assertNotPrivateUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfViolationError(url);
  }

  const hostname = parsed.hostname;

  // Fast path — block obviously private hostnames
  if (isBlockedHostname(hostname)) {
    throw new SsrfViolationError(hostname);
  }

  // Resolve DNS and check the resulting IP
  try {
    const { address, family } = await lookup(hostname);
    if (isPrivateIp(address, family as 4 | 6)) {
      throw new SsrfViolationError(hostname, address);
    }
  } catch (err) {
    if (err instanceof SsrfViolationError) throw err;
    // DNS resolution failure — let the fetch fail naturally
  }
}
