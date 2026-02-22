import { describe, it, expect, vi } from "vitest";
import { compareVersions, formatUpdateNotice, checkForUpdate } from "./update.js";
import type { UpdateCheckResult } from "./update.js";

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns positive when first is greater (major)", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
  });

  it("returns negative when first is less (major)", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("returns positive when first is greater (minor)", () => {
    expect(compareVersions("1.3.0", "1.2.0")).toBeGreaterThan(0);
  });

  it("returns positive when first is greater (patch)", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
  });

  it("handles versions with different segment counts", () => {
    expect(compareVersions("1.2.3", "1.2")).toBeGreaterThan(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("formatUpdateNotice", () => {
  it("returns null when no update is available", () => {
    const result: UpdateCheckResult = {
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateAvailable: false,
    };

    expect(formatUpdateNotice(result)).toBeNull();
  });

  it("returns formatted notice when update is available", () => {
    const result: UpdateCheckResult = {
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      updateAvailable: true,
    };

    const notice = formatUpdateNotice(result);
    expect(notice).toContain("1.0.0");
    expect(notice).toContain("1.1.0");
    expect(notice).toContain("npm install -g haya");
  });
});

describe("checkForUpdate", () => {
  it("returns updateAvailable=true when newer version exists", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "2.0.0" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate("1.0.0");

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("2.0.0");
    expect(result.currentVersion).toBe("1.0.0");

    vi.unstubAllGlobals();
  });

  it("returns updateAvailable=false when on latest version", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.0.0" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate("1.0.0");

    expect(result.updateAvailable).toBe(false);

    vi.unstubAllGlobals();
  });

  it("returns updateAvailable=false on fetch error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate("1.0.0");

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe("1.0.0");

    vi.unstubAllGlobals();
  });

  it("returns updateAvailable=false on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate("1.0.0");

    expect(result.updateAvailable).toBe(false);

    vi.unstubAllGlobals();
  });
});
