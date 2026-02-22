import type { BuiltinTool } from "./builtin-tools.js";

/**
 * Create the image analysis tool.
 * This tool constructs a prompt referencing an image URL that vision-capable
 * models can process when included in subsequent messages.
 */
export function createVisionTools(): BuiltinTool[] {
  return [
    {
      name: "image_analyze",
      description:
        "Analyze an image from a URL. Returns the image URL in a format that " +
        "vision-capable models can process for visual analysis.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL of the image to analyze",
          },
          prompt: {
            type: "string",
            description: "What to look for or analyze in the image",
          },
        },
        required: ["url"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const url = args.url as string;
        const prompt = args.prompt as string | undefined;
        if (!url) throw new Error("url is required");

        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error(`Invalid URL: ${url}`);
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(`Unsupported protocol: ${parsed.protocol}`);
        }

        const { assertNotPrivateUrl } = await import("../security/ssrf-guard.js");
        await assertNotPrivateUrl(url);

        return prompt
          ? `Please analyze this image: ${url}\n\nFocus on: ${prompt}`
          : `Please analyze this image: ${url}`;
      },
    },
  ];
}
