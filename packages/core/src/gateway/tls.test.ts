import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTlsOptions, generateSelfSignedCert, isCertValid } from "./tls.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `haya-tls-test-${randomBytes(8).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("TLS certificate management", () => {
  let tempDir: string;
  let certPath: string;
  let keyPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    certPath = join(tempDir, "cert.pem");
    keyPath = join(tempDir, "key.pem");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("generates self-signed certificate files", () => {
    generateSelfSignedCert({ certPath, keyPath });
    expect(existsSync(certPath)).toBe(true);
    expect(existsSync(keyPath)).toBe(true);
  });

  it("validates generated certificate as valid", () => {
    generateSelfSignedCert({ certPath, keyPath });
    expect(isCertValid(certPath)).toBe(true);
  });

  it("returns false for non-existent cert", () => {
    expect(isCertValid("/nonexistent/cert.pem")).toBe(false);
  });

  it("builds TLS options from cert files", () => {
    generateSelfSignedCert({ certPath, keyPath });
    const options = buildTlsOptions({ certPath, keyPath });
    expect(options.minVersion).toBe("TLSv1.3");
    expect(options.cert).toBeDefined();
    expect(options.key).toBeDefined();
  });

  it("throws when cert file does not exist", () => {
    expect(() =>
      buildTlsOptions({ certPath: "/nonexistent/cert.pem", keyPath }),
    ).toThrow(/cert file not found/i);
  });

  it("throws when key file does not exist", () => {
    generateSelfSignedCert({ certPath, keyPath });
    expect(() =>
      buildTlsOptions({
        certPath,
        keyPath: "/nonexistent/key.pem",
      }),
    ).toThrow(/key file not found/i);
  });
});
