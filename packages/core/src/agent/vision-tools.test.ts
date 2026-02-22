import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVisionTools } from "./vision-tools.js";
import type { AgentTool } from "./types.js";

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createVisionTools", () => {
  it("returns 1 tool named image_analyze with defaultPolicy allow", () => {
    const tools = createVisionTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("image_analyze");
    expect((tools[0] as AgentTool & { defaultPolicy: string }).defaultPolicy).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// image_analyze
// ---------------------------------------------------------------------------

describe("image_analyze", () => {
  let tool: AgentTool;

  beforeEach(() => {
    tool = getTool(createVisionTools(), "image_analyze");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns prompt with URL", async () => {
    const result = await tool.execute({
      url: "https://example.com/photo.jpg",
    });

    expect(result).toContain("Please analyze this image: https://example.com/photo.jpg");
  });

  it("returns prompt with custom analysis instruction", async () => {
    const result = await tool.execute({
      url: "https://example.com/photo.jpg",
      prompt: "Count the number of people",
    });

    expect(result).toContain("Please analyze this image: https://example.com/photo.jpg");
    expect(result).toContain("Focus on: Count the number of people");
  });

  it("throws on missing URL", async () => {
    await expect(tool.execute({})).rejects.toThrow("url is required");
  });

  it("throws on empty URL", async () => {
    await expect(tool.execute({ url: "" })).rejects.toThrow("url is required");
  });

  it("throws on invalid URL", async () => {
    await expect(
      tool.execute({ url: "not-a-valid-url" }),
    ).rejects.toThrow("Invalid URL");
  });

  it("throws on unsupported protocol", async () => {
    await expect(
      tool.execute({ url: "ftp://files.example.com/image.png" }),
    ).rejects.toThrow("Unsupported protocol");
  });
});
