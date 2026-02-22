import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { requireSecret } from "../config/secrets.js";
import type { BuiltinTool } from "./builtin-tools.js";

const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const REQUEST_TIMEOUT_MS = 120_000;

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".mpeg": "audio/mpeg",
  ".mpga": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

const SUPPORTED_EXTENSIONS = Object.keys(MIME_TYPES)
  .map((e) => e.slice(1))
  .join(", ");

/**
 * Create the audio transcription tool backed by the OpenAI Whisper API.
 */
export function createAudioTools(apiKeyEnvVar: string): BuiltinTool[] {
  return [
    {
      name: "audio_transcribe",
      description:
        "Transcribe an audio file to text using the OpenAI Whisper API. " +
        "Supports mp3, mp4, mpeg, mpga, m4a, wav, and webm files.",
      defaultPolicy: "confirm",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the audio file to transcribe",
          },
          language: {
            type: "string",
            description:
              'Optional ISO 639-1 language code (e.g., "en", "es", "ja")',
          },
        },
        required: ["file_path"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const filePath = args.file_path as string;
        if (!filePath) throw new Error("file_path is required");

        const ext = extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext];
        if (!mimeType) {
          throw new Error(
            `Unsupported audio format "${ext}". Supported formats: ${SUPPORTED_EXTENSIONS}`,
          );
        }

        const MAX_FILE_SIZE = 25 * 1024 * 1024;
        const fileSize = statSync(filePath).size;
        if (fileSize > MAX_FILE_SIZE) {
          throw new Error(`Audio file too large: ${(fileSize / (1024 * 1024)).toFixed(1)}MB exceeds 25MB Whisper API limit`);
        }

        let buffer: Buffer;
        try {
          buffer = readFileSync(filePath);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to read audio file: ${message}`);
        }

        const apiKey = requireSecret(apiKeyEnvVar);

        const blob = new Blob([buffer], { type: mimeType });
        const fileName = filePath.split("/").pop() ?? `audio${ext}`;

        const formData = new FormData();
        formData.append("file", blob, fileName);
        formData.append("model", "whisper-1");

        const language = args.language as string | undefined;
        if (language) {
          formData.append("language", language);
        }

        const response = await fetch(WHISPER_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `Whisper API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as { text: string };
        return data.text;
      },
    },
  ];
}
