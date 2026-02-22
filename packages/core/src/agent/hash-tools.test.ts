import { beforeEach, describe, expect, it } from "vitest";
import { createHashTools } from "./hash-tools.js";
import type { AgentTool } from "./types.js";

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createHashTools", () => {
  it("returns exactly 1 tool", () => {
    const tools = createHashTools();
    expect(tools).toHaveLength(1);
  });

  it("returns a tool named hash_encode", () => {
    const tools = createHashTools();
    expect(tools[0].name).toBe("hash_encode");
  });

  it("has operation and input parameters", () => {
    const tools = createHashTools();
    const tool = getTool(tools, "hash_encode");
    const props = tool.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("operation");
    expect(props).toHaveProperty("input");
    expect(tool.parameters.required).toEqual(["operation"]);
  });
});

// ---------------------------------------------------------------------------
// hash_encode operations
// ---------------------------------------------------------------------------

describe("hash_encode", () => {
  let tool: AgentTool;

  beforeEach(() => {
    tool = getTool(createHashTools(), "hash_encode");
  });

  // -------------------------------------------------------------------------
  // base64 round-trip
  // -------------------------------------------------------------------------

  it("base64_encode encodes a string to base64", async () => {
    const result = await tool.execute({
      operation: "base64_encode",
      input: "Hello, World!",
    });
    expect(result).toBe("SGVsbG8sIFdvcmxkIQ==");
  });

  it("base64_decode decodes base64 back to string", async () => {
    const result = await tool.execute({
      operation: "base64_decode",
      input: "SGVsbG8sIFdvcmxkIQ==",
    });
    expect(result).toBe("Hello, World!");
  });

  it("base64 round-trip preserves original input", async () => {
    const original = "The quick brown fox jumps over the lazy dog";
    const encoded = await tool.execute({
      operation: "base64_encode",
      input: original,
    });
    const decoded = await tool.execute({
      operation: "base64_decode",
      input: encoded,
    });
    expect(decoded).toBe(original);
  });

  // -------------------------------------------------------------------------
  // url encode/decode round-trip
  // -------------------------------------------------------------------------

  it("url_encode encodes special characters", async () => {
    const result = await tool.execute({
      operation: "url_encode",
      input: "hello world&foo=bar",
    });
    expect(result).toBe("hello%20world%26foo%3Dbar");
  });

  it("url_decode decodes percent-encoded strings", async () => {
    const result = await tool.execute({
      operation: "url_decode",
      input: "hello%20world%26foo%3Dbar",
    });
    expect(result).toBe("hello world&foo=bar");
  });

  it("url encode/decode round-trip preserves original input", async () => {
    const original = "https://example.com/path?q=hello world&lang=en";
    const encoded = await tool.execute({
      operation: "url_encode",
      input: original,
    });
    const decoded = await tool.execute({
      operation: "url_decode",
      input: encoded,
    });
    expect(decoded).toBe(original);
  });

  // -------------------------------------------------------------------------
  // sha256
  // -------------------------------------------------------------------------

  it("sha256 produces a 64-character hex string", async () => {
    const result = await tool.execute({
      operation: "sha256",
      input: "hello",
    });
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256 produces the correct hash for a known input", async () => {
    const result = await tool.execute({
      operation: "sha256",
      input: "hello",
    });
    // Known sha256 of "hello"
    expect(result).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  // -------------------------------------------------------------------------
  // sha512
  // -------------------------------------------------------------------------

  it("sha512 produces a 128-character hex string", async () => {
    const result = await tool.execute({
      operation: "sha512",
      input: "hello",
    });
    expect(result).toHaveLength(128);
    expect(result).toMatch(/^[0-9a-f]{128}$/);
  });

  it("sha512 produces the correct hash for a known input", async () => {
    const result = await tool.execute({
      operation: "sha512",
      input: "hello",
    });
    // Known sha512 of "hello"
    expect(result).toBe(
      "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043",
    );
  });

  // -------------------------------------------------------------------------
  // md5
  // -------------------------------------------------------------------------

  it("md5 produces a 32-character hex string", async () => {
    const result = await tool.execute({
      operation: "md5",
      input: "hello",
    });
    expect(result).toHaveLength(32);
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it("md5 produces the correct hash for a known input", async () => {
    const result = await tool.execute({
      operation: "md5",
      input: "hello",
    });
    // Known md5 of "hello"
    expect(result).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  // -------------------------------------------------------------------------
  // uuid
  // -------------------------------------------------------------------------

  it("uuid produces a valid UUID v4 format", async () => {
    const result = await tool.execute({ operation: "uuid" });
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("uuid ignores input parameter", async () => {
    const result = await tool.execute({
      operation: "uuid",
      input: "this should be ignored",
    });
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("uuid generates unique values", async () => {
    const result1 = await tool.execute({ operation: "uuid" });
    const result2 = await tool.execute({ operation: "uuid" });
    expect(result1).not.toBe(result2);
  });

  // -------------------------------------------------------------------------
  // jwt_decode
  // -------------------------------------------------------------------------

  it("jwt_decode parses a valid JWT", async () => {
    // Build a test JWT: header.payload.signature
    const header = { alg: "HS256", typ: "JWT" };
    const payload = { sub: "1234567890", name: "John Doe", iat: 1516239022 };

    const toBase64Url = (obj: Record<string, unknown>): string => {
      return Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    };

    const jwt = `${toBase64Url(header)}.${toBase64Url(payload)}.fake-signature`;

    const result = await tool.execute({
      operation: "jwt_decode",
      input: jwt,
    });

    const parsed = JSON.parse(result);
    expect(parsed.header).toEqual(header);
    expect(parsed.payload).toEqual(payload);
  });

  it("jwt_decode returns formatted JSON", async () => {
    const header = { alg: "HS256", typ: "JWT" };
    const payload = { sub: "123" };

    const toBase64Url = (obj: Record<string, unknown>): string => {
      return Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    };

    const jwt = `${toBase64Url(header)}.${toBase64Url(payload)}.sig`;

    const result = await tool.execute({
      operation: "jwt_decode",
      input: jwt,
    });

    // Should be pretty-printed JSON
    expect(result).toContain("\n");
    expect(result).toContain("  ");
  });

  it("jwt_decode throws for invalid JWT with wrong number of parts", async () => {
    await expect(
      tool.execute({ operation: "jwt_decode", input: "only.two" }),
    ).rejects.toThrow("Invalid JWT");
  });

  it("jwt_decode throws for a single segment", async () => {
    await expect(
      tool.execute({ operation: "jwt_decode", input: "notajwt" }),
    ).rejects.toThrow("Invalid JWT");
  });

  it("jwt_decode throws for malformed base64 in segments", async () => {
    await expect(
      tool.execute({
        operation: "jwt_decode",
        input: "!!!.@@@.###",
      }),
    ).rejects.toThrow("Failed to decode JWT");
  });

  // -------------------------------------------------------------------------
  // hex round-trip
  // -------------------------------------------------------------------------

  it("hex_encode encodes a string to hex", async () => {
    const result = await tool.execute({
      operation: "hex_encode",
      input: "Hello",
    });
    expect(result).toBe("48656c6c6f");
  });

  it("hex_decode decodes hex back to string", async () => {
    const result = await tool.execute({
      operation: "hex_decode",
      input: "48656c6c6f",
    });
    expect(result).toBe("Hello");
  });

  it("hex round-trip preserves original input", async () => {
    const original = "Hash & Encoding Utils!";
    const encoded = await tool.execute({
      operation: "hex_encode",
      input: original,
    });
    const decoded = await tool.execute({
      operation: "hex_decode",
      input: encoded,
    });
    expect(decoded).toBe(original);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("throws for unknown operation", async () => {
    await expect(
      tool.execute({ operation: "rot13", input: "hello" }),
    ).rejects.toThrow("Unknown operation: rot13");
  });

  it("throws when input is missing for non-uuid operations", async () => {
    await expect(
      tool.execute({ operation: "base64_encode" }),
    ).rejects.toThrow("input is required");
  });

  it("throws when input is missing for sha256", async () => {
    await expect(
      tool.execute({ operation: "sha256" }),
    ).rejects.toThrow("input is required");
  });

  it("throws when input is empty string for non-uuid operations", async () => {
    await expect(
      tool.execute({ operation: "md5", input: "" }),
    ).rejects.toThrow("input is required");
  });
});
