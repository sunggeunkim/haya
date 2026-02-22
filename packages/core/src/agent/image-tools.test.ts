import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createImageTools } from "./image-tools.js";
import type { AgentTool } from "./types.js";

vi.mock("../config/secrets.js", () => ({
  requireSecret: vi.fn().mockReturnValue("test-key"),
}));

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createImageTools", () => {
  it("returns 1 tool named image_generate with defaultPolicy confirm", () => {
    const tools = createImageTools("OPENAI_API_KEY");
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("image_generate");
    expect((tools[0] as AgentTool & { defaultPolicy: string }).defaultPolicy).toBe("confirm");
  });
});

// ---------------------------------------------------------------------------
// image_generate
// ---------------------------------------------------------------------------

describe("image_generate", () => {
  let tool: AgentTool;

  beforeEach(() => {
    tool = getTool(createImageTools("OPENAI_API_KEY"), "image_generate");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls DALL-E API with correct headers and body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              url: "https://images.openai.com/generated/abc.png",
              revised_prompt: "A cute cat sitting on a windowsill",
            },
          ],
        }),
      ),
    );

    await tool.execute({ prompt: "A cute cat" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(options.method).toBe("POST");

    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer test-key");

    const body = JSON.parse(options.body as string);
    expect(body.prompt).toBe("A cute cat");
  });

  it("returns URL and revised prompt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              url: "https://images.openai.com/generated/abc.png",
              revised_prompt: "A cute cat sitting on a windowsill",
            },
          ],
        }),
      ),
    );

    const result = await tool.execute({ prompt: "A cute cat" });

    expect(result).toContain("Image URL: https://images.openai.com/generated/abc.png");
    expect(result).toContain("Revised prompt: A cute cat sitting on a windowsill");
  });

  it("uses correct defaults (model dall-e-3, size 1024x1024, quality standard)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ url: "https://images.openai.com/gen.png" }],
        }),
      ),
    );

    await tool.execute({ prompt: "A sunset" });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.model).toBe("dall-e-3");
    expect(body.size).toBe("1024x1024");
    expect(body.quality).toBe("standard");
    expect(body.n).toBe(1);
  });

  it("passes custom size, quality, and model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ url: "https://images.openai.com/gen.png" }],
        }),
      ),
    );

    await tool.execute({
      prompt: "A sunset",
      size: "1792x1024",
      quality: "hd",
      model: "dall-e-2",
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.model).toBe("dall-e-2");
    expect(body.size).toBe("1792x1024");
    expect(body.quality).toBe("hd");
  });

  it("throws on missing prompt", async () => {
    await expect(tool.execute({})).rejects.toThrow("prompt is required");
  });

  it("throws on empty prompt", async () => {
    await expect(tool.execute({ prompt: "" })).rejects.toThrow("prompt is required");
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Rate limit exceeded", { status: 429, statusText: "Too Many Requests" }),
    );

    await expect(tool.execute({ prompt: "test" })).rejects.toThrow(
      "DALL-E API HTTP 429",
    );
  });
});
