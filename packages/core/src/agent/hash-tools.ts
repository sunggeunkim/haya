import type { BuiltinTool } from "./builtin-tools.js";

type Operation =
  | "base64_encode"
  | "base64_decode"
  | "url_encode"
  | "url_decode"
  | "sha256"
  | "sha512"
  | "md5"
  | "uuid"
  | "jwt_decode"
  | "hex_encode"
  | "hex_decode";

const VALID_OPERATIONS: readonly string[] = [
  "base64_encode",
  "base64_decode",
  "url_encode",
  "url_decode",
  "sha256",
  "sha512",
  "md5",
  "uuid",
  "jwt_decode",
  "hex_encode",
  "hex_decode",
];

/**
 * Create the hash/encoding utility tool.
 */
export function createHashTools(): BuiltinTool[] {
  return [
    {
      name: "hash_encode",
      description:
        "Perform hashing, encoding, and cryptographic utility operations. " +
        "Supports: base64_encode, base64_decode, url_encode, url_decode, " +
        "sha256, sha512, md5, uuid, jwt_decode, hex_encode, hex_decode.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: VALID_OPERATIONS,
            description: "The operation to perform",
          },
          input: {
            type: "string",
            description:
              "The input string to process (required for all operations except uuid)",
          },
        },
        required: ["operation"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const operation = args.operation as Operation;
        const input = args.input as string | undefined;

        if (!operation) {
          throw new Error("operation is required");
        }

        if (operation !== "uuid" && !input) {
          throw new Error("input is required for this operation");
        }

        switch (operation) {
          case "base64_encode": {
            const { Buffer } = await import("node:buffer");
            return Buffer.from(input!).toString("base64");
          }
          case "base64_decode": {
            const { Buffer } = await import("node:buffer");
            return Buffer.from(input!, "base64").toString("utf-8");
          }
          case "url_encode": {
            return encodeURIComponent(input!);
          }
          case "url_decode": {
            return decodeURIComponent(input!);
          }
          case "sha256": {
            const crypto = await import("node:crypto");
            return crypto.createHash("sha256").update(input!).digest("hex");
          }
          case "sha512": {
            const crypto = await import("node:crypto");
            return crypto.createHash("sha512").update(input!).digest("hex");
          }
          case "md5": {
            const crypto = await import("node:crypto");
            return crypto.createHash("md5").update(input!).digest("hex");
          }
          case "uuid": {
            const crypto = await import("node:crypto");
            return crypto.randomUUID();
          }
          case "jwt_decode": {
            const { Buffer } = await import("node:buffer");
            const parts = input!.split(".");
            if (parts.length !== 3) {
              throw new Error(
                "Invalid JWT: expected 3 dot-separated parts (header.payload.signature)",
              );
            }

            const decodeBase64Url = (segment: string): unknown => {
              // Convert base64url to standard base64
              const base64 = segment
                .replace(/-/g, "+")
                .replace(/_/g, "/");
              const json = Buffer.from(base64, "base64").toString("utf-8");
              return JSON.parse(json) as unknown;
            };

            try {
              const header = decodeBase64Url(parts[0]);
              const payload = decodeBase64Url(parts[1]);
              return JSON.stringify({ header, payload }, null, 2);
            } catch (err) {
              const message =
                err instanceof Error ? err.message : String(err);
              throw new Error(`Failed to decode JWT: ${message}`);
            }
          }
          case "hex_encode": {
            const { Buffer } = await import("node:buffer");
            return Buffer.from(input!).toString("hex");
          }
          case "hex_decode": {
            const { Buffer } = await import("node:buffer");
            return Buffer.from(input!, "hex").toString("utf-8");
          }
          default:
            throw new Error(`Unknown operation: ${operation as string}`);
        }
      },
    },
  ];
}
