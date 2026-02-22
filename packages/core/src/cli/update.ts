import { createLogger } from "../infra/logger.js";

const log = createLogger("update");

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

/**
 * Check if a newer version of Haya is available.
 */
export async function checkForUpdate(
  currentVersion: string,
): Promise<UpdateCheckResult> {
  try {
    const response = await fetch("https://registry.npmjs.org/haya/latest", {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
      };
    }

    const data = (await response.json()) as { version: string };
    const latestVersion = data.version;
    const updateAvailable =
      latestVersion !== currentVersion &&
      compareVersions(latestVersion, currentVersion) > 0;

    return { currentVersion, latestVersion, updateAvailable };
  } catch {
    log.debug("Failed to check for updates");
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
    };
  }
}

/**
 * Simple semver comparison. Returns positive if a > b, negative if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function formatUpdateNotice(
  result: UpdateCheckResult,
): string | null {
  if (!result.updateAvailable) return null;
  return `\nUpdate available: ${result.currentVersion} → ${result.latestVersion}\nRun: npm install -g haya\n`;
}
