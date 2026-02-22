import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createGatewayHttpServer } from "../server-http.js";

let server: Server;
let baseUrl: string;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = createGatewayHttpServer({
      host: "127.0.0.1",
      port: 0, // will resolve from socket
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
}

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("web chat serve", async () => {
  await startServer();

  it("GET /chat returns 200 with HTML content type", async () => {
    const res = await fetch(`${baseUrl}/chat`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("GET /chat/ (trailing slash) also returns 200 with HTML", async () => {
    const res = await fetch(`${baseUrl}/chat/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("other URLs still return 404", async () => {
    const res = await fetch(`${baseUrl}/chat/foo`);
    expect(res.status).toBe(404);
  });

  it("HTML contains a CSP nonce in script and style tags", async () => {
    const res = await fetch(`${baseUrl}/chat`);
    const html = await res.text();

    // Extract the nonce from the CSP header
    const csp = res.headers.get("content-security-policy") || "";
    const nonceMatch = csp.match(/nonce-([A-Za-z0-9+/=]+)/);
    expect(nonceMatch).not.toBeNull();
    const nonce = nonceMatch![1];

    // The HTML should contain the nonce in script and style tags
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain(`<style nonce="${nonce}">`);
  });

  it("HTML contains WebSocket connection code", async () => {
    const res = await fetch(`${baseUrl}/chat`);
    const html = await res.text();

    expect(html).toContain("new WebSocket");
    expect(html).toContain("ws://");
    expect(html).toContain("chat.send");
  });

  it("HTML contains the Haya Chat title", async () => {
    const res = await fetch(`${baseUrl}/chat`);
    const html = await res.text();

    expect(html).toContain("<title>Haya Chat</title>");
    expect(html).toContain("Haya Chat");
  });

  it("HTML escapes message content to prevent XSS", async () => {
    const res = await fetch(`${baseUrl}/chat`);
    const html = await res.text();

    // The JS should use an escapeHtml function
    expect(html).toContain("escapeHtml");
  });

  it("web chat page uses relaxed CSP allowing ws:", async () => {
    const res = await fetch(`${baseUrl}/chat`);
    const csp = res.headers.get("content-security-policy") || "";

    // Web chat CSP should allow both ws: and wss:
    expect(csp).toContain("ws:");
    expect(csp).toContain("wss:");
  });

  it("non-chat pages still use strict CSP (wss: only)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const csp = res.headers.get("content-security-policy") || "";

    expect(csp).toContain("wss:");
    // Should NOT contain standalone ws: (only wss:)
    expect(csp).not.toMatch(/connect-src[^;]*\bws:/);
  });
});
