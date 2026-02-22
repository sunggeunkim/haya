import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveSecret } from "../config/secrets.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleAuthConfig {
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  scopes: string[];
  tokenPath?: string;
  refreshTokenEnvVar?: string;
}

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
}

/**
 * Manages Google OAuth2 token lifecycle.
 * Supports both pre-configured refresh tokens (via env var) and
 * interactive browser consent flow for first-time setup.
 */
export class GoogleAuth {
  private readonly config: GoogleAuthConfig;
  private readonly tokenPath: string;
  private tokens: StoredTokens | null = null;

  constructor(config: GoogleAuthConfig) {
    this.config = config;
    this.tokenPath = config.tokenPath ?? "data/google-tokens.json";
    this.loadTokens();
  }

  /**
   * Returns a valid access token, refreshing if expired.
   * Throws if no tokens are available (authorize() must be called first).
   */
  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      // Try loading from env var
      const refreshToken = this.config.refreshTokenEnvVar
        ? resolveSecret(this.config.refreshTokenEnvVar)
        : undefined;
      if (refreshToken) {
        this.tokens = {
          access_token: "",
          refresh_token: refreshToken,
          expires_at: 0,
          scope: this.config.scopes.join(" "),
        };
      } else {
        throw new Error(
          "Google OAuth not authorized. Run 'haya google auth' to set up authentication.",
        );
      }
    }

    // Refresh if expired (with 60s buffer)
    if (Date.now() >= this.tokens.expires_at - 60_000) {
      await this.refreshAccessToken();
    }

    return this.tokens.access_token;
  }

  /**
   * Check if tokens exist (either stored or via env var).
   */
  isAuthorized(): boolean {
    if (this.tokens) return true;
    if (this.config.refreshTokenEnvVar) {
      const val = resolveSecret(this.config.refreshTokenEnvVar);
      return val !== undefined && val !== "";
    }
    return false;
  }

  /**
   * Interactive browser consent flow.
   * Opens a browser to Google's OAuth consent page, receives the callback
   * on a local HTTP server, exchanges the code for tokens, and saves them.
   */
  async authorize(): Promise<void> {
    const clientId = resolveSecret(this.config.clientIdEnvVar);
    const clientSecret = resolveSecret(this.config.clientSecretEnvVar);
    if (!clientId) throw new Error(`${this.config.clientIdEnvVar} is not set`);
    if (!clientSecret) throw new Error(`${this.config.clientSecretEnvVar} is not set`);

    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? "/", `http://localhost`);
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
            server.close();
            reject(new Error(`Google OAuth error: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("<h1>Missing authorization code</h1>");
            return;
          }

          // Exchange code for tokens
          const addr = server.address();
          const port = typeof addr === "object" && addr ? addr.port : 0;
          const redirectUri = `http://localhost:${port}`;

          const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              grant_type: "authorization_code",
            }),
          });

          if (!tokenResponse.ok) {
            const errBody = await tokenResponse.text();
            res.writeHead(500, { "Content-Type": "text/html" });
            res.end(`<h1>Token exchange failed</h1><pre>${errBody}</pre>`);
            server.close();
            reject(new Error(`Token exchange failed: ${tokenResponse.status}`));
            return;
          }

          const data = (await tokenResponse.json()) as Record<string, unknown>;
          this.tokens = {
            access_token: data.access_token as string,
            refresh_token: data.refresh_token as string,
            expires_at: Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
            scope: (data.scope as string) ?? this.config.scopes.join(" "),
          };
          this.saveTokens();

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>",
          );
          server.close();
          resolve();
        } catch (err) {
          server.close();
          reject(err);
        }
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const redirectUri = `http://localhost:${port}`;

        const authUrl = new URL(GOOGLE_AUTH_URL);
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", this.config.scopes.join(" "));
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");

        console.log("\nOpen this URL in your browser to authorize:\n");
        console.log(authUrl.toString());
        console.log("\nWaiting for authorization...\n");

        // Try to open browser automatically
        const openUrl = authUrl.toString();
        import("node:child_process")
          .then(({ exec }) => {
            const cmd =
              process.platform === "darwin"
                ? `open "${openUrl}"`
                : process.platform === "win32"
                  ? `start "" "${openUrl}"`
                  : `xdg-open "${openUrl}"`;
            exec(cmd, () => {
              // Ignore errors — URL is already printed
            });
          })
          .catch(() => {
            // Ignore — URL is already printed
          });
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error("Authorization timed out after 5 minutes"));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Revoke tokens and delete the stored token file.
   */
  async revokeTokens(): Promise<void> {
    if (this.tokens?.access_token) {
      await fetch(
        `${GOOGLE_REVOKE_URL}?token=${this.tokens.access_token}`,
        { method: "POST" },
      ).catch(() => {
        // Best-effort revocation
      });
    }
    this.tokens = null;
    if (existsSync(this.tokenPath)) {
      const { rmSync } = await import("node:fs");
      rmSync(this.tokenPath);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refresh_token) {
      throw new Error("No refresh token available");
    }

    const clientId = resolveSecret(this.config.clientIdEnvVar);
    const clientSecret = resolveSecret(this.config.clientSecretEnvVar);
    if (!clientId) throw new Error(`${this.config.clientIdEnvVar} is not set`);
    if (!clientSecret) throw new Error(`${this.config.clientSecretEnvVar} is not set`);

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    this.tokens.access_token = data.access_token as string;
    this.tokens.expires_at = Date.now() + ((data.expires_in as number) ?? 3600) * 1000;

    // Google may issue a new refresh token
    if (data.refresh_token) {
      this.tokens.refresh_token = data.refresh_token as string;
    }

    this.saveTokens();
  }

  private loadTokens(): void {
    if (!existsSync(this.tokenPath)) return;
    try {
      const raw = readFileSync(this.tokenPath, "utf-8");
      this.tokens = JSON.parse(raw) as StoredTokens;
    } catch {
      // Corrupt file — ignore
      this.tokens = null;
    }
  }

  private saveTokens(): void {
    if (!this.tokens) return;
    const dir = dirname(this.tokenPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(this.tokenPath, JSON.stringify(this.tokens, null, 2), {
      mode: 0o600,
    });
  }
}

// ── Shared helper for tool files ─────────────────────────────────────────

/**
 * Call a Google API endpoint with OAuth2 authorization.
 */
export async function callGoogleApi(
  url: string,
  auth: GoogleAuth,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  const token = await auth.getAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Haya/0.1",
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google API ${response.status}: ${errText}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Call a Google API endpoint and return raw text (for file exports).
 */
export async function callGoogleApiText(
  url: string,
  auth: GoogleAuth,
  options: RequestInit = {},
): Promise<string> {
  const token = await auth.getAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Haya/0.1",
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google API ${response.status}: ${errText}`);
  }

  return response.text();
}
