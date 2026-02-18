import { existsSync, readFileSync, statSync } from "node:fs";
import type { TlsOptions } from "node:tls";
import { safeExecSync } from "../security/command-exec.js";

/**
 * TLS configuration: ECDSA P-384, SHA-384, 90-day certificates, TLSv1.3 minimum.
 * Fixes HIGH-5 (weak TLS certs).
 */

const CERT_VALIDITY_DAYS = 90;
const CERT_RENEW_THRESHOLD_DAYS = 7;

export interface TlsCertPaths {
  certPath: string;
  keyPath: string;
}

/**
 * Generate a self-signed ECDSA P-384 certificate using openssl.
 */
export function generateSelfSignedCert(paths: TlsCertPaths): void {
  safeExecSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-384",
    "-sha384",
    "-days",
    String(CERT_VALIDITY_DAYS),
    "-nodes",
    "-keyout",
    paths.keyPath,
    "-out",
    paths.certPath,
    "-subj",
    "/CN=haya-gateway",
  ]);
}

/**
 * Check if a certificate file exists and is still valid (not expiring soon).
 */
export function isCertValid(certPath: string): boolean {
  if (!existsSync(certPath)) return false;

  try {
    const output = safeExecSync("openssl", [
      "x509",
      "-in",
      certPath,
      "-noout",
      "-enddate",
    ]);
    // Output: "notAfter=Feb 18 00:00:00 2026 GMT"
    const match = output.match(/notAfter=(.+)/);
    if (!match?.[1]) return false;

    const expiryDate = new Date(match[1]);
    const now = new Date();
    const daysUntilExpiry =
      (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    return daysUntilExpiry > CERT_RENEW_THRESHOLD_DAYS;
  } catch {
    return false;
  }
}

/**
 * Ensure valid TLS certificates exist, generating if necessary.
 */
export function ensureTlsCerts(paths: TlsCertPaths): void {
  if (!isCertValid(paths.certPath)) {
    generateSelfSignedCert(paths);
  }
}

/**
 * Build TLS options for the HTTPS server.
 * Enforces TLSv1.3 minimum.
 */
export function buildTlsOptions(paths: TlsCertPaths): TlsOptions {
  if (!existsSync(paths.certPath)) {
    throw new Error(`TLS cert file not found: ${paths.certPath}`);
  }
  if (!existsSync(paths.keyPath)) {
    throw new Error(`TLS key file not found: ${paths.keyPath}`);
  }

  return {
    cert: readFileSync(paths.certPath),
    key: readFileSync(paths.keyPath),
    minVersion: "TLSv1.3",
  };
}
