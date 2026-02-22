import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleAuth } from "./auth.js";
import type { GoogleAuthConfig } from "./auth.js";

function makeConfig(tokenPath: string, overrides?: Partial<GoogleAuthConfig>): GoogleAuthConfig {
  return {
    clientIdEnvVar: "TEST_GOOGLE_CLIENT_ID",
    clientSecretEnvVar: "TEST_GOOGLE_CLIENT_SECRET",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    tokenPath,
    ...overrides,
  };
}

describe("GoogleAuth", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "haya-google-auth-"));
    vi.stubEnv("TEST_GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("TEST_GOOGLE_CLIENT_SECRET", "test-client-secret");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("constructor", () => {
    it("creates instance without stored tokens", () => {
      const tokenPath = join(tmpDir, "tokens.json");
      const auth = new GoogleAuth(makeConfig(tokenPath));
      expect(auth.isAuthorized()).toBe(false);
    });

    it("loads existing tokens from disk", () => {
      const tokenPath = join(tmpDir, "tokens.json");
      const tokens = {
        access_token: "stored-access-token",
        refresh_token: "stored-refresh-token",
        expires_at: Date.now() + 3600_000,
        scope: "calendar.events",
      };
      writeFileSync(tokenPath, JSON.stringify(tokens));

      const auth = new GoogleAuth(makeConfig(tokenPath));
      expect(auth.isAuthorized()).toBe(true);
    });

    it("handles corrupt token file gracefully", () => {
      const tokenPath = join(tmpDir, "tokens.json");
      writeFileSync(tokenPath, "not-valid-json{{{");

      const auth = new GoogleAuth(makeConfig(tokenPath));
      expect(auth.isAuthorized()).toBe(false);
    });
  });

  describe("isAuthorized", () => {
    it("returns true when refresh token is available via env var", () => {
      vi.stubEnv("TEST_REFRESH_TOKEN", "env-refresh-token");
      const tokenPath = join(tmpDir, "no-tokens.json");
      const auth = new GoogleAuth(
        makeConfig(tokenPath, { refreshTokenEnvVar: "TEST_REFRESH_TOKEN" }),
      );
      expect(auth.isAuthorized()).toBe(true);
    });

    it("returns false when refresh token env var is empty", () => {
      vi.stubEnv("TEST_REFRESH_TOKEN", "");
      const tokenPath = join(tmpDir, "no-tokens.json");
      const auth = new GoogleAuth(
        makeConfig(tokenPath, { refreshTokenEnvVar: "TEST_REFRESH_TOKEN" }),
      );
      expect(auth.isAuthorized()).toBe(false);
    });
  });

  describe("getAccessToken", () => {
    it("returns stored access token when not expired", async () => {
      const tokenPath = join(tmpDir, "tokens.json");
      const tokens = {
        access_token: "valid-access-token",
        refresh_token: "refresh-token",
        expires_at: Date.now() + 3600_000,
        scope: "calendar.events",
      };
      writeFileSync(tokenPath, JSON.stringify(tokens));

      const auth = new GoogleAuth(makeConfig(tokenPath));
      const token = await auth.getAccessToken();
      expect(token).toBe("valid-access-token");
    });

    it("refreshes expired access token", async () => {
      const tokenPath = join(tmpDir, "tokens.json");
      const tokens = {
        access_token: "expired-token",
        refresh_token: "refresh-token",
        expires_at: Date.now() - 1000, // expired
        scope: "calendar.events",
      };
      writeFileSync(tokenPath, JSON.stringify(tokens));

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access-token",
            expires_in: 3600,
          }),
        ),
      );

      const auth = new GoogleAuth(makeConfig(tokenPath));
      const token = await auth.getAccessToken();
      expect(token).toBe("new-access-token");

      // Verify token was saved to disk
      const saved = JSON.parse(readFileSync(tokenPath, "utf-8"));
      expect(saved.access_token).toBe("new-access-token");
    });

    it("uses refresh token from env var when no stored tokens", async () => {
      vi.stubEnv("TEST_REFRESH_TOKEN", "env-refresh-token");
      const tokenPath = join(tmpDir, "no-tokens.json");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            expires_in: 3600,
          }),
        ),
      );

      const auth = new GoogleAuth(
        makeConfig(tokenPath, { refreshTokenEnvVar: "TEST_REFRESH_TOKEN" }),
      );
      const token = await auth.getAccessToken();
      expect(token).toBe("fresh-access-token");
    });

    it("throws when no tokens and no env var configured", async () => {
      const tokenPath = join(tmpDir, "no-tokens.json");
      const auth = new GoogleAuth(makeConfig(tokenPath));

      await expect(auth.getAccessToken()).rejects.toThrow(
        "Google OAuth not authorized",
      );
    });

    it("throws when token refresh fails", async () => {
      const tokenPath = join(tmpDir, "tokens.json");
      const tokens = {
        access_token: "expired",
        refresh_token: "bad-refresh",
        expires_at: 0,
        scope: "calendar.events",
      };
      writeFileSync(tokenPath, JSON.stringify(tokens));

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("invalid_grant", { status: 400 }),
      );

      const auth = new GoogleAuth(makeConfig(tokenPath));
      await expect(auth.getAccessToken()).rejects.toThrow(
        "Token refresh failed",
      );
    });

    it("sends correct refresh token request", async () => {
      const tokenPath = join(tmpDir, "tokens.json");
      const tokens = {
        access_token: "expired",
        refresh_token: "my-refresh-token",
        expires_at: 0,
        scope: "calendar.events",
      };
      writeFileSync(tokenPath, JSON.stringify(tokens));

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-token",
            expires_in: 3600,
          }),
        ),
      );

      const auth = new GoogleAuth(makeConfig(tokenPath));
      await auth.getAccessToken();

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(init?.method).toBe("POST");

      const body = init?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("my-refresh-token");
      expect(body.get("client_id")).toBe("test-client-id");
      expect(body.get("client_secret")).toBe("test-client-secret");
    });

    it("persists new refresh token when Google issues one", async () => {
      const tokenPath = join(tmpDir, "tokens.json");
      const tokens = {
        access_token: "expired",
        refresh_token: "old-refresh",
        expires_at: 0,
        scope: "calendar.events",
      };
      writeFileSync(tokenPath, JSON.stringify(tokens));

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh-token",
            expires_in: 3600,
          }),
        ),
      );

      const auth = new GoogleAuth(makeConfig(tokenPath));
      await auth.getAccessToken();

      const saved = JSON.parse(readFileSync(tokenPath, "utf-8"));
      expect(saved.refresh_token).toBe("new-refresh-token");
    });
  });

  describe("revokeTokens", () => {
    it("deletes stored tokens from disk", async () => {
      const tokenPath = join(tmpDir, "tokens.json");
      writeFileSync(
        tokenPath,
        JSON.stringify({
          access_token: "to-revoke",
          refresh_token: "rt",
          expires_at: Date.now() + 3600_000,
          scope: "calendar.events",
        }),
      );

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(""));

      const auth = new GoogleAuth(makeConfig(tokenPath));
      expect(auth.isAuthorized()).toBe(true);

      await auth.revokeTokens();
      expect(existsSync(tokenPath)).toBe(false);
      expect(auth.isAuthorized()).toBe(false);
    });

    it("handles revocation when no tokens exist", async () => {
      const tokenPath = join(tmpDir, "no-tokens.json");
      const auth = new GoogleAuth(makeConfig(tokenPath));

      // Should not throw
      await auth.revokeTokens();
    });
  });
});
