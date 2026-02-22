import { requireSecret } from "../config/secrets.js";
import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 60_000;
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";

interface DalleResponse {
  data?: Array<{
    url: string;
    revised_prompt?: string;
  }>;
}

/**
 * Create agent tools for image generation via DALL-E.
 */
export function createImageTools(apiKeyEnvVar: string): BuiltinTool[] {
  return [
    {
      name: "image_generate",
      description:
        "Generate an image using DALL-E. Returns the URL of the generated image " +
        "and the revised prompt used by the model.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Text description of the image to generate",
          },
          size: {
            type: "string",
            enum: ["1024x1024", "1792x1024", "1024x1792"],
            description: "Image dimensions (default: 1024x1024)",
          },
          quality: {
            type: "string",
            enum: ["standard", "hd"],
            description: "Image quality (default: standard)",
          },
          model: {
            type: "string",
            enum: ["dall-e-3", "dall-e-2"],
            description: "DALL-E model version (default: dall-e-3)",
          },
        },
        required: ["prompt"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const prompt = args.prompt as string;
        if (!prompt) throw new Error("prompt is required");

        const apiKey = requireSecret(apiKeyEnvVar);
        const body = {
          model: (args.model as string) ?? "dall-e-3",
          prompt,
          n: 1,
          size: (args.size as string) ?? "1024x1024",
          quality: (args.quality as string) ?? "standard",
        };

        const response = await fetch(OPENAI_IMAGES_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`DALL-E API HTTP ${response.status}: ${text}`);
        }

        const data = (await response.json()) as DalleResponse;
        const image = data.data?.[0];
        if (!image) throw new Error("No image returned from DALL-E");

        const lines: string[] = [];
        lines.push(`Image URL: ${image.url}`);
        if (image.revised_prompt) {
          lines.push(`Revised prompt: ${image.revised_prompt}`);
        }
        return lines.join("\n");
      },
    },
  ];
}
