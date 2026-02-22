import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertNotPrivateUrl,
  isBlockedHostname,
  SsrfViolationError,
} from "./ssrf-guard.js";

// Mock dns.promises.lookup
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

describe("isBlockedHostname", () => {
  it("blocks localhost", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("LOCALHOST")).toBe(true);
    expect(isBlockedHostname("localhost.")).toBe(true);
  });

  it("blocks .local domains", () => {
    expect(isBlockedHostname("printer.local")).toBe(true);
    expect(isBlockedHostname("myhost.local.")).toBe(true);
  });

  it("blocks 127.x.x.x", () => {
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
    expect(isBlockedHostname("127.255.255.255")).toBe(true);
  });

  it("blocks 10.x.x.x", () => {
    expect(isBlockedHostname("10.0.0.1")).toBe(true);
    expect(isBlockedHostname("10.255.0.1")).toBe(true);
  });

  it("blocks 172.16-31.x.x", () => {
    expect(isBlockedHostname("172.16.0.1")).toBe(true);
    expect(isBlockedHostname("172.31.255.255")).toBe(true);
  });

  it("blocks 192.168.x.x", () => {
    expect(isBlockedHostname("192.168.1.1")).toBe(true);
  });

  it("blocks 169.254.x.x (link-local)", () => {
    expect(isBlockedHostname("169.254.1.1")).toBe(true);
  });

  it("blocks 0.x.x.x", () => {
    expect(isBlockedHostname("0.0.0.0")).toBe(true);
  });

  it("blocks IPv6 loopback", () => {
    expect(isBlockedHostname("::1")).toBe(true);
    expect(isBlockedHostname("[::1]")).toBe(true);
  });

  it("blocks IPv6 ULA (fc00::/7)", () => {
    expect(isBlockedHostname("fc00::1")).toBe(true);
    expect(isBlockedHostname("fd12:3456::1")).toBe(true);
  });

  it("allows public hostnames", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
    expect(isBlockedHostname("api.github.com")).toBe(false);
  });
});

describe("assertNotPrivateUrl", () => {
  let mockLookup: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const dns = await import("node:dns/promises");
    mockLookup = dns.lookup as ReturnType<typeof vi.fn>;
    mockLookup.mockReset();
  });

  it("blocks URL with localhost hostname", async () => {
    await expect(
      assertNotPrivateUrl("http://localhost:8080/api"),
    ).rejects.toThrow(SsrfViolationError);
  });

  it("blocks URL with private IP hostname", async () => {
    await expect(
      assertNotPrivateUrl("http://192.168.1.1/admin"),
    ).rejects.toThrow(SsrfViolationError);
  });

  it("blocks URL that resolves to private IP", async () => {
    mockLookup.mockResolvedValue({ address: "10.0.0.5", family: 4 });
    await expect(
      assertNotPrivateUrl("http://internal.corp.example.com/secret"),
    ).rejects.toThrow(SsrfViolationError);
  });

  it("blocks URL that resolves to IPv6 loopback", async () => {
    mockLookup.mockResolvedValue({ address: "::1", family: 6 });
    await expect(
      assertNotPrivateUrl("http://tricky.example.com/"),
    ).rejects.toThrow(SsrfViolationError);
  });

  it("blocks URL that resolves to IPv4-mapped IPv6 private", async () => {
    mockLookup.mockResolvedValue({
      address: "::ffff:192.168.0.1",
      family: 6,
    });
    await expect(
      assertNotPrivateUrl("http://mapped.example.com/"),
    ).rejects.toThrow(SsrfViolationError);
  });

  it("allows URL that resolves to public IP", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    await expect(
      assertNotPrivateUrl("https://example.com"),
    ).resolves.toBeUndefined();
  });

  it("throws SsrfViolationError for invalid URL", async () => {
    await expect(assertNotPrivateUrl("not-a-url")).rejects.toThrow(
      SsrfViolationError,
    );
  });

  it("allows URL when DNS lookup fails (let fetch handle it)", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      assertNotPrivateUrl("https://nonexistent.example.com"),
    ).resolves.toBeUndefined();
  });

  it("includes hostname and resolved IP in error", async () => {
    mockLookup.mockResolvedValue({ address: "10.0.0.5", family: 4 });
    try {
      await assertNotPrivateUrl("http://evil.example.com/");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SsrfViolationError);
      const ssrfErr = err as SsrfViolationError;
      expect(ssrfErr.hostname).toBe("evil.example.com");
      expect(ssrfErr.resolvedIp).toBe("10.0.0.5");
    }
  });
});
