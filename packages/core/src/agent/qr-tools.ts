import { safeExecSync } from "../security/command-exec.js";
import type { BuiltinTool } from "./builtin-tools.js";

/**
 * Create QR code generation and decoding tools.
 */
export function createQrTools(): BuiltinTool[] {
  return [
    // -----------------------------------------------------------------
    // qr_generate
    // -----------------------------------------------------------------
    {
      name: "qr_generate",
      description:
        "Generate a QR code image from text and save it as a PNG file.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text content to encode in the QR code",
          },
          output_path: {
            type: "string",
            description:
              "Path to save the QR code PNG image (default: /tmp/haya-qr-{timestamp}.png)",
          },
        },
        required: ["text"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const text = args.text as string;
        if (!text) throw new Error("text is required");

        const outputPath =
          (args.output_path as string) ??
          `/tmp/haya-qr-${Date.now()}.png`;

        const workspace = (args as Record<string, unknown>).__workspace as string | undefined;
        if (workspace) {
          const { WorkspaceGuard } = await import("../security/workspace.js");
          const guard = new WorkspaceGuard([workspace]);
          guard.validatePath(outputPath);
        }

        try {
          safeExecSync("qrencode", ["-o", outputPath, "-t", "PNG", text]);
          return `QR code saved to ${outputPath}`;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          if (
            message.includes("ENOENT") ||
            message.includes("not found") ||
            message.includes("No such file")
          ) {
            throw new Error(
              "qrencode is not installed. Install it with: sudo apt install qrencode",
            );
          }
          throw new Error(`Failed to generate QR code: ${message}`);
        }
      },
    },

    // -----------------------------------------------------------------
    // qr_decode
    // -----------------------------------------------------------------
    {
      name: "qr_decode",
      description:
        "Decode a QR code from an image file and return the encoded text.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Path to the QR code image to decode",
          },
        },
        required: ["image_path"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const imagePath = args.image_path as string;
        if (!imagePath) throw new Error("image_path is required");

        const workspace = (args as Record<string, unknown>).__workspace as string | undefined;
        if (workspace) {
          const { WorkspaceGuard } = await import("../security/workspace.js");
          const guard = new WorkspaceGuard([workspace]);
          guard.validatePath(imagePath);
        }

        try {
          const output = safeExecSync("zbarimg", [
            "--quiet",
            "--raw",
            imagePath,
          ]);
          return output.trim();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          if (
            message.includes("ENOENT") ||
            message.includes("not found") ||
            message.includes("No such file")
          ) {
            throw new Error(
              "zbarimg is not installed. Install it with: sudo apt install zbar-tools",
            );
          }
          throw new Error(`Failed to decode QR code: ${message}`);
        }
      },
    },
  ];
}
