import { isIP } from "node:net";

/**
 * IP resolution and proxy trust utilities.
 * X-Forwarded-For is only honored when the socket's remote address
 * matches an explicitly configured trusted proxy (fixes HIGH-6).
 */

export function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("::ffff:127.")) return true;
  return false;
}

export function normalizeIPv4Mapped(ip: string): string {
  if (ip.startsWith("::ffff:")) {
    return ip.slice("::ffff:".length);
  }
  return ip;
}

function normalizeIp(ip: string | undefined): string | undefined {
  const trimmed = ip?.trim();
  if (!trimmed) return undefined;
  return normalizeIPv4Mapped(trimmed.toLowerCase());
}

/**
 * Parse the first IP from an X-Forwarded-For header.
 */
export function parseForwardedForClientIp(
  forwardedFor: string | undefined,
): string | undefined {
  const raw = forwardedFor?.split(",")[0]?.trim();
  if (!raw) return undefined;
  return normalizeIp(stripPort(raw));
}

/**
 * Check if an IP address matches a CIDR block or exact IP.
 */
export function ipMatchesCIDR(ip: string, cidr: string): boolean {
  if (!cidr.includes("/")) {
    return ip === cidr;
  }

  const [subnet, prefixLenStr] = cidr.split("/");
  if (!subnet || !prefixLenStr) return false;
  const prefixLen = parseInt(prefixLenStr, 10);

  if (Number.isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) {
    return false;
  }

  const ipNum = ipv4ToInt(ip);
  const subnetNum = ipv4ToInt(subnet);
  if (ipNum === null || subnetNum === null) return false;

  const mask = prefixLen === 0 ? 0 : (-1 >>> (32 - prefixLen)) << (32 - prefixLen);
  return (ipNum & mask) === (subnetNum & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0;
}

/**
 * Check if an IP is in the trusted proxies list.
 */
export function isTrustedProxy(
  ip: string | undefined,
  trustedProxies: string[],
): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized || trustedProxies.length === 0) return false;

  return trustedProxies.some((proxy) => {
    const candidate = proxy.trim();
    if (!candidate) return false;
    if (candidate.includes("/")) {
      return ipMatchesCIDR(normalized, candidate);
    }
    return normalizeIp(candidate) === normalized;
  });
}

/**
 * Resolve the true client IP from request metadata.
 * X-Forwarded-For and X-Real-IP are ONLY honored when the socket's
 * remote address matches a configured trusted proxy.
 */
export function resolveClientIp(params: {
  remoteAddr: string | undefined;
  forwardedFor?: string;
  realIp?: string;
  trustedProxies: string[];
}): string | undefined {
  const remote = normalizeIp(params.remoteAddr);
  if (!remote) return undefined;

  if (!isTrustedProxy(remote, params.trustedProxies)) {
    return remote;
  }

  return (
    parseForwardedForClientIp(params.forwardedFor) ??
    normalizeIp(params.realIp?.trim()) ??
    remote
  );
}

/**
 * Resolve the bind host address for the gateway.
 */
export function resolveBindHost(
  bind: "loopback" | "lan" | "custom",
  customHost?: string,
): string {
  switch (bind) {
    case "loopback":
      return "127.0.0.1";
    case "lan":
      return "0.0.0.0";
    case "custom":
      return customHost?.trim() || "0.0.0.0";
  }
}

function stripPort(raw: string): string {
  // Handle bracketed IPv6 [::1]:port
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end !== -1) return raw.slice(1, end);
  }
  // If it's a valid IP already, return as-is
  if (isIP(raw)) return raw;
  // Try stripping port from IPv4:port
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > -1 && raw.includes(".") && raw.indexOf(":") === lastColon) {
    const candidate = raw.slice(0, lastColon);
    if (isIP(candidate) === 4) return candidate;
  }
  return raw;
}
