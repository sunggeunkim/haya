import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadSkill, loadSkillsFromDirectory } from "./loader.js";

describe("loadSkill", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `haya-skill-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads a valid skill directory", async () => {
    const skillDir = join(testDir, "my-skill");
    await mkdir(skillDir, { recursive: true });

    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "my-skill",
        name: "My Skill",
        version: "1.0.0",
        description: "A test skill",
      }),
    );

    await writeFile(
      join(skillDir, "index.mjs"),
      `export const tools = [
        {
          name: "greet",
          description: "Greets someone",
          parameters: { name: { type: "string" } },
          execute: async (args) => "Hello " + args.name,
        },
      ];`,
    );

    // Use index.mjs as entry point
    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "my-skill",
        name: "My Skill",
        version: "1.0.0",
        description: "A test skill",
        main: "index.mjs",
      }),
    );

    const skill = await loadSkill(skillDir);

    expect(skill.manifest.id).toBe("my-skill");
    expect(skill.manifest.name).toBe("My Skill");
    expect(skill.status).toBe("loaded");
    expect(skill.module.tools).toHaveLength(1);
    expect(skill.module.tools[0].name).toBe("greet");
    expect(skill.path).toBe(skillDir);
  });

  it("throws NotFoundError when skill.json is missing", async () => {
    const skillDir = join(testDir, "empty-skill");
    await mkdir(skillDir, { recursive: true });

    await expect(loadSkill(skillDir)).rejects.toThrow("skill.json not found");
  });

  it("throws ValidationError for invalid JSON in skill.json", async () => {
    const skillDir = join(testDir, "bad-json");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "skill.json"), "not valid json {{{");

    await expect(loadSkill(skillDir)).rejects.toThrow("Invalid JSON");
  });

  it("throws ValidationError for invalid manifest schema", async () => {
    const skillDir = join(testDir, "bad-manifest");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "INVALID CAPS!",
        name: "Bad",
      }),
    );

    await expect(loadSkill(skillDir)).rejects.toThrow("Invalid skill manifest");
  });

  it("throws ValidationError when manifest is missing required fields", async () => {
    const skillDir = join(testDir, "missing-fields");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({ id: "ok" }),
    );

    await expect(loadSkill(skillDir)).rejects.toThrow("Invalid skill manifest");
  });

  it("returns error status when entry point cannot be imported", async () => {
    const skillDir = join(testDir, "bad-entry");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "bad-entry",
        name: "Bad Entry",
        version: "1.0.0",
        description: "Skill with bad entry point",
        main: "does-not-exist.js",
      }),
    );

    const skill = await loadSkill(skillDir);

    expect(skill.status).toBe("error");
    expect(skill.error).toContain("Failed to import entry point");
  });

  it("returns error status when module does not export tools array", async () => {
    const skillDir = join(testDir, "no-tools");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "no-tools",
        name: "No Tools",
        version: "1.0.0",
        description: "Skill without tools export",
        main: "index.mjs",
      }),
    );
    await writeFile(
      join(skillDir, "index.mjs"),
      `export const foo = "bar";`,
    );

    const skill = await loadSkill(skillDir);

    expect(skill.status).toBe("error");
    expect(skill.error).toContain("does not export a \"tools\" array");
  });

  it("warns but still loads when required env vars are missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const skillDir = join(testDir, "env-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "env-skill",
        name: "Env Skill",
        version: "1.0.0",
        description: "Skill needing env vars",
        main: "index.mjs",
        requiredEnvVars: ["HAYA_TEST_SECRET_NONEXISTENT"],
      }),
    );
    await writeFile(
      join(skillDir, "index.mjs"),
      `export const tools = [];`,
    );

    const skill = await loadSkill(skillDir);

    // Should still load despite missing env var
    expect(skill.status).toBe("loaded");
    expect(skill.manifest.requiredEnvVars).toContain(
      "HAYA_TEST_SECRET_NONEXISTENT",
    );

    warnSpy.mockRestore();
  });

  it("picks up setup and teardown exports from the module", async () => {
    const skillDir = join(testDir, "lifecycle-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "lifecycle-skill",
        name: "Lifecycle Skill",
        version: "1.0.0",
        description: "Has setup/teardown",
        main: "index.mjs",
      }),
    );
    await writeFile(
      join(skillDir, "index.mjs"),
      `
      export const tools = [];
      export async function setup() {}
      export async function teardown() {}
      `,
    );

    const skill = await loadSkill(skillDir);

    expect(skill.status).toBe("loaded");
    expect(typeof skill.module.setup).toBe("function");
    expect(typeof skill.module.teardown).toBe("function");
  });

  it("uses default permissions when not specified", async () => {
    const skillDir = join(testDir, "default-perms");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "default-perms",
        name: "Default Perms",
        version: "1.0.0",
        description: "No permissions specified",
        main: "index.mjs",
      }),
    );
    await writeFile(join(skillDir, "index.mjs"), `export const tools = [];`);

    const skill = await loadSkill(skillDir);

    expect(skill.manifest.permissions).toEqual({
      network: false,
      filesystem: false,
      shell: false,
    });
  });
});

describe("loadSkillsFromDirectory", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `haya-skills-dir-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads multiple skills from subdirectories", async () => {
    // Skill A
    const skillA = join(testDir, "skill-a");
    await mkdir(skillA, { recursive: true });
    await writeFile(
      join(skillA, "skill.json"),
      JSON.stringify({
        id: "skill-a",
        name: "Skill A",
        version: "1.0.0",
        description: "First skill",
        main: "index.mjs",
      }),
    );
    await writeFile(join(skillA, "index.mjs"), `export const tools = [];`);

    // Skill B
    const skillB = join(testDir, "skill-b");
    await mkdir(skillB, { recursive: true });
    await writeFile(
      join(skillB, "skill.json"),
      JSON.stringify({
        id: "skill-b",
        name: "Skill B",
        version: "2.0.0",
        description: "Second skill",
        main: "index.mjs",
      }),
    );
    await writeFile(join(skillB, "index.mjs"), `export const tools = [];`);

    const skills = await loadSkillsFromDirectory(testDir);

    expect(skills).toHaveLength(2);
    const ids = skills.map((s) => s.manifest.id).sort();
    expect(ids).toEqual(["skill-a", "skill-b"]);
  });

  it("skips subdirectories without skill.json", async () => {
    const withManifest = join(testDir, "valid");
    await mkdir(withManifest, { recursive: true });
    await writeFile(
      join(withManifest, "skill.json"),
      JSON.stringify({
        id: "valid",
        name: "Valid",
        version: "1.0.0",
        description: "Has manifest",
        main: "index.mjs",
      }),
    );
    await writeFile(
      join(withManifest, "index.mjs"),
      `export const tools = [];`,
    );

    const withoutManifest = join(testDir, "no-manifest");
    await mkdir(withoutManifest, { recursive: true });
    await writeFile(join(withoutManifest, "README.md"), "# Hello");

    const skills = await loadSkillsFromDirectory(testDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].manifest.id).toBe("valid");
  });

  it("skips plain files in the base directory", async () => {
    await writeFile(join(testDir, "stray-file.txt"), "not a skill");

    const skills = await loadSkillsFromDirectory(testDir);
    expect(skills).toHaveLength(0);
  });

  it("throws NotFoundError when base directory does not exist", async () => {
    await expect(
      loadSkillsFromDirectory(join(testDir, "nonexistent")),
    ).rejects.toThrow("Skills directory not found");
  });

  it("continues loading when one skill fails", async () => {
    // Good skill
    const good = join(testDir, "good");
    await mkdir(good, { recursive: true });
    await writeFile(
      join(good, "skill.json"),
      JSON.stringify({
        id: "good",
        name: "Good",
        version: "1.0.0",
        description: "Valid skill",
        main: "index.mjs",
      }),
    );
    await writeFile(join(good, "index.mjs"), `export const tools = [];`);

    // Bad skill (invalid manifest)
    const bad = join(testDir, "bad");
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, "skill.json"), "not valid json");

    const skills = await loadSkillsFromDirectory(testDir);

    // Only the good skill should be loaded
    expect(skills).toHaveLength(1);
    expect(skills[0].manifest.id).toBe("good");
  });
});
