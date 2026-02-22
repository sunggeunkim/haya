import { resolve, join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { SkillManifestSchema } from "./types.js";
import type { LoadedSkill, SkillModule } from "./types.js";
import { NotFoundError, ValidationError } from "../infra/errors.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("skill-loader");

/**
 * Load a single skill from a directory path.
 *
 * The directory must contain a `skill.json` manifest and the entry point
 * referenced by that manifest (defaults to `index.js`).
 */
export async function loadSkill(skillDir: string): Promise<LoadedSkill> {
  const resolvedDir = resolve(skillDir);
  const manifestPath = join(resolvedDir, "skill.json");

  // --- Read and parse manifest ---
  let rawManifest: string;
  try {
    rawManifest = await readFile(manifestPath, "utf-8");
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new NotFoundError(
        `skill.json not found in ${resolvedDir}`,
        err,
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch (err) {
    throw new ValidationError(
      `Invalid JSON in ${manifestPath}`,
      err,
    );
  }

  const result = SkillManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `Invalid skill manifest in ${manifestPath}: ${result.error.issues.map((i) => i.message).join("; ")}`,
      result.error,
    );
  }

  const manifest = result.data;

  // --- Check required env vars (warn only) ---
  for (const envVar of manifest.requiredEnvVars) {
    if (!process.env[envVar]) {
      log.warn(
        `Skill "${manifest.id}" requires env var ${envVar} which is not set`,
      );
    }
  }

  // --- Dynamically import the entry point ---
  const entryPath = join(resolvedDir, manifest.main);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(entryPath)) as Record<string, unknown>;
  } catch (err) {
    return {
      manifest,
      module: { tools: [] },
      path: resolvedDir,
      status: "error",
      error: `Failed to import entry point "${manifest.main}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // --- Validate module shape ---
  const tools = mod.tools;
  if (!Array.isArray(tools)) {
    return {
      manifest,
      module: { tools: [] },
      path: resolvedDir,
      status: "error",
      error: `Skill module "${manifest.id}" does not export a "tools" array`,
    };
  }

  const skillModule: SkillModule = {
    tools: tools as SkillModule["tools"],
    setup: typeof mod.setup === "function"
      ? (mod.setup as SkillModule["setup"])
      : undefined,
    teardown: typeof mod.teardown === "function"
      ? (mod.teardown as SkillModule["teardown"])
      : undefined,
  };

  return {
    manifest,
    module: skillModule,
    path: resolvedDir,
    status: "loaded",
  };
}

/**
 * Scan a directory for subdirectories containing `skill.json` files
 * and load each one. Failures in individual skills are captured rather
 * than aborting the whole batch.
 */
export async function loadSkillsFromDirectory(
  baseDir: string,
): Promise<LoadedSkill[]> {
  const resolvedBase = resolve(baseDir);
  let entries: string[];

  try {
    entries = await readdir(resolvedBase);
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new NotFoundError(
        `Skills directory not found: ${resolvedBase}`,
        err,
      );
    }
    throw err;
  }

  const skills: LoadedSkill[] = [];

  for (const entry of entries) {
    const entryPath = join(resolvedBase, entry);

    // Only look at directories
    let info;
    try {
      info = await stat(entryPath);
    } catch {
      continue;
    }
    if (!info.isDirectory()) continue;

    // Only load if skill.json exists
    const manifestPath = join(entryPath, "skill.json");
    try {
      await stat(manifestPath);
    } catch {
      continue;
    }

    try {
      const skill = await loadSkill(entryPath);
      skills.push(skill);
      log.info(`Loaded skill "${skill.manifest.id}" from ${entryPath}`);
    } catch (err) {
      log.error(
        `Failed to load skill from ${entryPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return skills;
}
