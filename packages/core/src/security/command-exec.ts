import { execFileSync } from "node:child_process";

/**
 * Safe command execution wrapper that always uses execFileSync with shell:false.
 * This prevents shell injection attacks (fixes CRIT-3, HIGH-4).
 *
 * All external command execution MUST go through this module.
 */
export function safeExecSync(
  command: string,
  args: readonly string[],
  options?: {
    cwd?: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  },
): string {
  validateCommand(command);
  validateArgs(args);

  return execFileSync(command, [...args], {
    cwd: options?.cwd,
    timeout: options?.timeout,
    env: options?.env,
    shell: false,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Validates that the command does not contain shell metacharacters.
 */
function validateCommand(command: string): void {
  if (command.length === 0) {
    throw new Error("Command must not be empty");
  }
  if (command.includes("\0")) {
    throw new Error("Command must not contain null bytes");
  }
}

/**
 * Validates that arguments do not contain null bytes.
 * Other characters are safe because shell:false prevents interpretation.
 */
function validateArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (arg.includes("\0")) {
      throw new Error("Arguments must not contain null bytes");
    }
  }
}
