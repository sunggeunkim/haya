import type { BuiltinTool } from "./builtin-tools.js";

const MAX_RESPONSE_LENGTH = 16_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;

/**
 * Create the sandboxed JavaScript code evaluation tool.
 */
export function createCodeEvalTools(): BuiltinTool[] {
  return [
    {
      name: "code_eval",
      description:
        "Safely evaluate a JavaScript expression or code snippet in a sandboxed environment. " +
        "Use this for calculations, data transformations, string manipulation, and quick scripts. " +
        "The sandbox has no access to the filesystem, network, or process.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The JavaScript code to evaluate",
          },
          timeout: {
            type: "number",
            description:
              "Execution timeout in milliseconds (default: 5000, max: 30000)",
          },
        },
        required: ["code"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const code = args.code as string;
        if (!code) throw new Error("code is required");

        const timeout = Math.min(
          Math.max((args.timeout as number) ?? DEFAULT_TIMEOUT_MS, 1),
          MAX_TIMEOUT_MS,
        );

        const { runInNewContext } = await import("node:vm");

        const logs: string[] = [];

        const sandbox = Object.create(null) as Record<string, unknown>;
        Object.assign(sandbox, {
          JSON,
          Math,
          Date,
          Array,
          Object,
          String,
          Number,
          Boolean,
          RegExp,
          Map,
          Set,
          parseInt,
          parseFloat,
          isNaN,
          isFinite,
          encodeURIComponent,
          decodeURIComponent,
          console: Object.freeze({
            log: (...logArgs: unknown[]) =>
              logs.push(logArgs.map(String).join(" ")),
          }),
        });

        let result: unknown;
        try {
          result = runInNewContext(code, sandbox, { timeout, microtaskMode: "afterEvaluate" });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : String(err);
          return `Error: ${message}`;
        }

        let resultStr: string;
        if (result === undefined) {
          resultStr = "undefined";
        } else if (result === null) {
          resultStr = "null";
        } else if (typeof result === "object") {
          try {
            resultStr = JSON.stringify(result);
          } catch {
            resultStr = String(result);
          }
        } else {
          resultStr = String(result);
        }

        let output = `Result: ${resultStr}`;

        if (logs.length > 0) {
          output += `\n\nConsole output:\n${logs.join("\n")}`;
        }

        if (output.length > MAX_RESPONSE_LENGTH) {
          return `${output.slice(0, MAX_RESPONSE_LENGTH)}\n\n[Truncated — ${output.length} chars total]`;
        }

        return output;
      },
    },
  ];
}
