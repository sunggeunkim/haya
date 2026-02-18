import { describe, expect, it } from "vitest";
import {
  ipMatchesCIDR,
  isLoopbackAddress,
  isTrustedProxy,
  normalizeIPv4Mapped,
  parseForwardedForClientIp,
  resolveBindHost,
  resolveClientIp,
} from "./net.js";

describe("isLoopbackAddress", () => {
  it("recognizes 127.0.0.1", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
  });

  it("recognizes 127.x.x.x", () => {
    expect(isLoopbackAddress("127.0.0.2")).toBe(true);
    expect(isLoopbackAddress("127.255.255.255")).toBe(true);
  });

  it("recognizes ::1", () => {
    expect(isLoopbackAddress("::1")).toBe(true);
  });

  it("recognizes IPv4-mapped loopback", () => {
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects non-loopback addresses", () => {
    expect(isLoopbackAddress("192.168.1.1")).toBe(false);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress("8.8.8.8")).toBe(false);
  });

  it("returns false for undefined/empty", () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
  });
});

describe("normalizeIPv4Mapped", () => {
  it("strips ::ffff: prefix", () => {
    expect(normalizeIPv4Mapped("::ffff:192.168.1.1")).toBe("192.168.1.1");
  });

  it("returns non-mapped addresses as-is", () => {
    expect(normalizeIPv4Mapped("192.168.1.1")).toBe("192.168.1.1");
    expect(normalizeIPv4Mapped("::1")).toBe("::1");
  });
});

describe("parseForwardedForClientIp", () => {
  it("extracts first IP from comma-separated list", () => {
    expect(parseForwardedForClientIp("1.2.3.4, 5.6.7.8, 9.10.11.12")).toBe(
      "1.2.3.4",
    );
  });

  it("handles single IP", () => {
    expect(parseForwardedForClientIp("1.2.3.4")).toBe("1.2.3.4");
  });

  it("returns undefined for empty/missing", () => {
    expect(parseForwardedForClientIp(undefined)).toBeUndefined();
    expect(parseForwardedForClientIp("")).toBeUndefined();
  });

  it("normalizes IPv4-mapped addresses", () => {
    expect(parseForwardedForClientIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("ipMatchesCIDR", () => {
  it("matches exact IP when no CIDR", () => {
    expect(ipMatchesCIDR("10.0.0.1", "10.0.0.1")).toBe(true);
    expect(ipMatchesCIDR("10.0.0.1", "10.0.0.2")).toBe(false);
  });

  it("matches within CIDR /24", () => {
    expect(ipMatchesCIDR("10.42.0.59", "10.42.0.0/24")).toBe(true);
    expect(ipMatchesCIDR("10.42.1.59", "10.42.0.0/24")).toBe(false);
  });

  it("matches within CIDR /16", () => {
    expect(ipMatchesCIDR("172.16.5.10", "172.16.0.0/16")).toBe(true);
    expect(ipMatchesCIDR("172.17.0.1", "172.16.0.0/16")).toBe(false);
  });

  it("matches /0 (all IPs)", () => {
    expect(ipMatchesCIDR("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });

  it("returns false for invalid CIDR", () => {
    expect(ipMatchesCIDR("1.2.3.4", "not/valid")).toBe(false);
  });
});

describe("isTrustedProxy", () => {
  it("returns false when no trusted proxies configured", () => {
    expect(isTrustedProxy("10.0.0.1", [])).toBe(false);
  });

  it("returns false for undefined IP", () => {
    expect(isTrustedProxy(undefined, ["10.0.0.1"])).toBe(false);
  });

  it("matches exact IP", () => {
    expect(isTrustedProxy("10.0.0.1", ["10.0.0.1"])).toBe(true);
  });

  it("matches CIDR range", () => {
    expect(isTrustedProxy("10.42.0.59", ["10.42.0.0/24"])).toBe(true);
  });

  it("rejects non-matching IP", () => {
    expect(isTrustedProxy("192.168.1.1", ["10.0.0.1"])).toBe(false);
  });
});

describe("resolveClientIp", () => {
  it("returns remote addr when no trusted proxies", () => {
    expect(
      resolveClientIp({
        remoteAddr: "1.2.3.4",
        forwardedFor: "5.6.7.8",
        trustedProxies: [],
      }),
    ).toBe("1.2.3.4");
  });

  it("ignores X-Forwarded-For when remote is not a trusted proxy", () => {
    expect(
      resolveClientIp({
        remoteAddr: "1.2.3.4",
        forwardedFor: "5.6.7.8",
        trustedProxies: ["10.0.0.1"],
      }),
    ).toBe("1.2.3.4");
  });

  it("uses X-Forwarded-For when remote IS a trusted proxy", () => {
    expect(
      resolveClientIp({
        remoteAddr: "10.0.0.1",
        forwardedFor: "5.6.7.8",
        trustedProxies: ["10.0.0.1"],
      }),
    ).toBe("5.6.7.8");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is missing", () => {
    expect(
      resolveClientIp({
        remoteAddr: "10.0.0.1",
        realIp: "5.6.7.8",
        trustedProxies: ["10.0.0.1"],
      }),
    ).toBe("5.6.7.8");
  });

  it("falls back to remote addr when both headers missing", () => {
    expect(
      resolveClientIp({
        remoteAddr: "10.0.0.1",
        trustedProxies: ["10.0.0.1"],
      }),
    ).toBe("10.0.0.1");
  });

  it("returns undefined for missing remote addr", () => {
    expect(
      resolveClientIp({
        remoteAddr: undefined,
        trustedProxies: [],
      }),
    ).toBeUndefined();
  });
});

describe("resolveBindHost", () => {
  it("returns 127.0.0.1 for loopback", () => {
    expect(resolveBindHost("loopback")).toBe("127.0.0.1");
  });

  it("returns 0.0.0.0 for lan", () => {
    expect(resolveBindHost("lan")).toBe("0.0.0.0");
  });

  it("returns custom host for custom mode", () => {
    expect(resolveBindHost("custom", "192.168.1.100")).toBe("192.168.1.100");
  });

  it("falls back to 0.0.0.0 for empty custom host", () => {
    expect(resolveBindHost("custom")).toBe("0.0.0.0");
    expect(resolveBindHost("custom", "")).toBe("0.0.0.0");
  });
});
