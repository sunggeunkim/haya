import type { AgentTool } from "../agent/types.js";
import type { LoadedSkill, SkillStatus } from "./types.js";
import { ValidationError } from "../infra/errors.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("skill-registry");

/**
 * Stores loaded skills by ID and manages their lifecycle.
 *
 * Skills are registered after loading and their tools are aggregated
 * so the agent runtime can discover them.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, LoadedSkill>();

  /** Register a loaded skill. Throws if a skill with the same ID exists. */
  register(skill: LoadedSkill): void {
    if (this.skills.has(skill.manifest.id)) {
      throw new ValidationError(
        `Skill "${skill.manifest.id}" is already registered`,
      );
    }
    this.skills.set(skill.manifest.id, skill);
    log.info(
      `Registered skill "${skill.manifest.id}" (${skill.module.tools.length} tools)`,
    );
  }

  /** Unregister a skill by ID. Returns true if it was present. */
  unregister(id: string): boolean {
    const existed = this.skills.delete(id);
    if (existed) {
      log.info(`Unregistered skill "${id}"`);
    }
    return existed;
  }

  /** Get a loaded skill by ID. */
  get(id: string): LoadedSkill | undefined {
    return this.skills.get(id);
  }

  /** List status of all registered skills. */
  list(): SkillStatus[] {
    return Array.from(this.skills.values()).map((s) => ({
      manifest: s.manifest,
      status: s.status,
      error: s.error,
      path: s.path,
    }));
  }

  /** Aggregate all tools from all loaded (non-error) skills. */
  getAllTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const skill of this.skills.values()) {
      if (skill.status !== "loaded") continue;
      for (const tool of skill.module.tools) {
        tools.push({
          ...tool,
          name: `${skill.manifest.id}:${tool.name}`,
        });
      }
    }
    return tools;
  }

  /** Call setup() on every loaded skill that provides one. */
  async setupAll(): Promise<void> {
    for (const skill of this.skills.values()) {
      if (skill.status !== "loaded") continue;
      if (skill.module.setup) {
        try {
          await skill.module.setup();
          log.info(`Setup completed for skill "${skill.manifest.id}"`);
        } catch (err) {
          skill.status = "error";
          skill.error = err instanceof Error ? err.message : String(err);
          log.error(
            `Setup failed for skill "${skill.manifest.id}": ${skill.error}`,
          );
        }
      }
    }
  }

  /** Call teardown() on every loaded skill that provides one. */
  async teardownAll(): Promise<void> {
    for (const skill of this.skills.values()) {
      if (skill.module.teardown) {
        try {
          await skill.module.teardown();
          log.info(`Teardown completed for skill "${skill.manifest.id}"`);
        } catch (err) {
          log.error(
            `Teardown failed for skill "${skill.manifest.id}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
}
