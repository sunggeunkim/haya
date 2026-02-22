import { existsSync, mkdirSync, statSync } from "node:fs";
import { extname } from "node:path";
import { safeExecSync } from "../security/command-exec.js";
import type { BuiltinTool } from "./builtin-tools.js";

/**
 * Detect archive format from the output path extension.
 */
function detectFormat(filePath: string): "zip" | "tar.gz" {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return "tar.gz";
  }
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  // Default to tar.gz if extension is ambiguous
  return "tar.gz";
}

/**
 * Detect extraction format from the archive path extension.
 */
function detectExtractFormat(archivePath: string): "zip" | "tar.gz" {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return "tar.gz";
  }
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  throw new Error(
    `Cannot determine archive format from extension: ${extname(archivePath)}. ` +
      "Supported formats: .zip, .tar.gz, .tgz",
  );
}

/**
 * Create archive creation and extraction tools.
 */
export function createArchiveTools(): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------------
    // archive_create
    // -----------------------------------------------------------------------
    {
      name: "archive_create",
      description:
        "Create a zip or tar.gz archive from files or directories.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          output_path: {
            type: "string",
            description:
              'Output archive path (e.g., "/tmp/backup.tar.gz")',
          },
          source_paths: {
            type: "array",
            items: { type: "string" },
            description: "Files or directories to include in the archive",
          },
          format: {
            type: "string",
            enum: ["zip", "tar.gz"],
            description:
              "Archive format. Defaults to format detected from output_path extension.",
          },
        },
        required: ["output_path", "source_paths"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const outputPath = args.output_path as string;
        const sourcePaths = args.source_paths as string[];

        if (!outputPath) throw new Error("output_path is required");
        if (!sourcePaths || sourcePaths.length === 0) {
          throw new Error("source_paths is required and must not be empty");
        }

        const workspace = (args as Record<string, unknown>).__workspace as string | undefined;
        if (workspace) {
          const { WorkspaceGuard } = await import("../security/workspace.js");
          const guard = new WorkspaceGuard([workspace]);
          guard.validatePath(outputPath);
          for (const sp of sourcePaths) {
            guard.validatePath(sp);
          }
        }

        const format =
          (args.format as "zip" | "tar.gz" | undefined) ??
          detectFormat(outputPath);

        if (format === "tar.gz") {
          safeExecSync("tar", ["-czf", outputPath, ...sourcePaths]);
        } else {
          safeExecSync("zip", ["-r", outputPath, ...sourcePaths]);
        }

        const stat = statSync(outputPath);
        return `Created archive: ${outputPath} (${stat.size} bytes)`;
      },
    },

    // -----------------------------------------------------------------------
    // archive_extract
    // -----------------------------------------------------------------------
    {
      name: "archive_extract",
      description:
        "Extract a zip or tar.gz archive to a directory.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          archive_path: {
            type: "string",
            description: "Path to the archive file",
          },
          output_dir: {
            type: "string",
            description: "Directory to extract the archive into",
          },
        },
        required: ["archive_path", "output_dir"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const archivePath = args.archive_path as string;
        const outputDir = args.output_dir as string;

        if (!archivePath) throw new Error("archive_path is required");
        if (!outputDir) throw new Error("output_dir is required");

        const workspace = (args as Record<string, unknown>).__workspace as string | undefined;
        if (workspace) {
          const { WorkspaceGuard } = await import("../security/workspace.js");
          const guard = new WorkspaceGuard([workspace]);
          guard.validatePath(archivePath);
          guard.validatePath(outputDir);
        }

        if (!existsSync(archivePath)) {
          throw new Error(`Archive not found: ${archivePath}`);
        }

        // Ensure output directory exists
        mkdirSync(outputDir, { recursive: true });

        const format = detectExtractFormat(archivePath);

        if (format === "tar.gz") {
          safeExecSync("tar", ["-xzf", archivePath, "-C", outputDir]);
        } else {
          safeExecSync("unzip", ["-o", archivePath, "-d", outputDir]);
        }

        return `Extracted to ${outputDir}`;
      },
    },
  ];
}
