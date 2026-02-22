import { z } from "zod";
import type { AgentTool } from "../agent/types.js";

/** Schema for a skill manifest (skill.json) */
export const SkillManifestSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      "Skill ID must be lowercase alphanumeric with dashes",
    ),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  /** Entry point relative to the skill directory */
  main: z.string().default("index.js"),
  /** Environment variables required by this skill */
  requiredEnvVars: z.array(z.string()).default([]),
  /** Permissions needed */
  permissions: z
    .object({
      network: z.boolean().default(false),
      filesystem: z.boolean().default(false),
      shell: z.boolean().default(false),
    })
    .default({}),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/** What a skill module must export */
export interface SkillModule {
  /** Tools provided by this skill */
  tools: AgentTool[];
  /** Optional setup function called once on load */
  setup?: () => Promise<void>;
  /** Optional teardown function */
  teardown?: () => Promise<void>;
}

export interface LoadedSkill {
  manifest: SkillManifest;
  module: SkillModule;
  path: string;
  status: "loaded" | "error" | "disabled";
  error?: string;
}

export type SkillStatus = Pick<
  LoadedSkill,
  "manifest" | "status" | "error" | "path"
>;
