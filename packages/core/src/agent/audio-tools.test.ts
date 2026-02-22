import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioTools } from "./audio-tools.js";
import type { AgentTool } from "./types.js";

vi.mock("../config/secrets.js", () => ({
  requireSecret: vi.fn().mockReturnValue("test-openai-key"),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from("fake-audio-data")),
}));

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createAudioTools", () => {
  it("returns 1 tool named audio_transcribe", () => {
    const tools = createAudioTools("OPENAI_API_KEY");
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("audio_transcribe");
  });

  it("tool has required fields", () => {
    const tools = createAudioTools("OPENAI_API_KEY");
    const tool = tools[0];
    expect(tool.description).toBeTruthy();
    expect(
      (tool as AgentTool & { defaultPolicy: string }).defaultPolicy,
    ).toBe("confirm");
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// audio_transcribe
// ---------------------------------------------------------------------------

describe("audio_transcribe", () => {
  let tool: AgentTool;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tool = getTool(createAudioTools("OPENAI_API_KEY"), "audio_transcribe");
    globalThis.fetch = vi.fn();

    // Re-apply default mock implementations after any previous restoreAllMocks
    const secrets = await import("../config/secrets.js");
    (secrets.requireSecret as ReturnType<typeof vi.fn>).mockReturnValue(
      "test-openai-key",
    );

    const fs = await import("node:fs");
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      Buffer.from("fake-audio-data"),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns transcribed text on success", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: "Hello, world!" }),
    });

    const result = await tool.execute({ file_path: "/tmp/test.mp3" });
    expect(result).toBe("Hello, world!");
  });

  it("calls correct API endpoint with proper headers", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: "test" }),
    });

    await tool.execute({ file_path: "/tmp/test.wav" });

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(callArgs[0]).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    expect(callArgs[1].method).toBe("POST");
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-openai-key");
  });

  it("maps file extensions to correct MIME types", async () => {
    const extensionToMime: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".mp4": "audio/mp4",
      ".mpeg": "audio/mpeg",
      ".mpga": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".wav": "audio/wav",
      ".webm": "audio/webm",
    };

    for (const [ext, expectedMime] of Object.entries(extensionToMime)) {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: "test" }),
      });

      await tool.execute({ file_path: `/tmp/audio${ext}` });

      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls.at(-1) as [string, RequestInit];
      const body = callArgs[1].body as FormData;
      const file = body.get("file") as File;
      expect(file.type).toBe(expectedMime);
    }
  });

  it("passes language parameter when provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: "Hola mundo" }),
    });

    await tool.execute({ file_path: "/tmp/test.mp3", language: "es" });

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const body = callArgs[1].body as FormData;
    expect(body.get("language")).toBe("es");
  });

  it("does not include language when not provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: "test" }),
    });

    await tool.execute({ file_path: "/tmp/test.mp3" });

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const body = callArgs[1].body as FormData;
    expect(body.get("language")).toBeNull();
  });

  it("throws on missing file", async () => {
    const { readFileSync } = await import("node:fs");
    (readFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    await expect(
      tool.execute({ file_path: "/tmp/nonexistent.mp3" }),
    ).rejects.toThrow("Failed to read audio file");
  });

  it("throws on unsupported file extension", async () => {
    await expect(
      tool.execute({ file_path: "/tmp/audio.ogg" }),
    ).rejects.toThrow("Unsupported audio format");
  });

  it("throws on API error response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    await expect(
      tool.execute({ file_path: "/tmp/test.mp3" }),
    ).rejects.toThrow("Whisper API HTTP 429");
  });

  it("throws when API key is missing", async () => {
    const { requireSecret } = await import("../config/secrets.js");
    (requireSecret as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error(
        'Required environment variable "OPENAI_API_KEY" is not set or empty.',
      );
    });

    await expect(
      tool.execute({ file_path: "/tmp/test.mp3" }),
    ).rejects.toThrow("not set or empty");
  });

  it("throws when file_path is missing", async () => {
    await expect(tool.execute({})).rejects.toThrow("file_path is required");
  });

  it("sends model whisper-1 in the form data", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: "test" }),
    });

    await tool.execute({ file_path: "/tmp/test.mp3" });

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const body = callArgs[1].body as FormData;
    expect(body.get("model")).toBe("whisper-1");
  });
});
