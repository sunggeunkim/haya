import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHttpTools } from "./http-tools.js";

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe("createHttpTools", () => {
  it("returns one tool named http_request", () => {
    const tools = createHttpTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("http_request");
  });

  it("tool has required fields", () => {
    const tools = createHttpTools();
    const tool = tools[0];
    expect(tool.description).toBeTruthy();
    expect(tool.defaultPolicy).toBe("confirm");
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// http_request tool
// ---------------------------------------------------------------------------

describe("http_request", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockResponse(options: {
    status?: number;
    statusText?: string;
    body?: string;
    headers?: Record<string, string>;
  }) {
    const headers = new Headers(options.headers ?? {});
    return {
      status: options.status ?? 200,
      statusText: options.statusText ?? "OK",
      headers,
      text: vi.fn().mockResolvedValue(options.body ?? ""),
    };
  }

  it("makes a GET request with defaults", async () => {
    const mock = createMockResponse({
      body: '{"message":"hello"}',
      headers: { "content-type": "application/json" },
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const tools = createHttpTools();
    const result = await tools[0].execute({ url: "https://api.example.com/data" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toContain("HTTP 200 OK");
    expect(result).toContain('{"message":"hello"}');
    expect(result).toContain("content-type: application/json");
  });

  it("makes a POST request with JSON body", async () => {
    const mock = createMockResponse({
      status: 201,
      statusText: "Created",
      body: '{"id":1}',
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const tools = createHttpTools();
    const result = await tools[0].execute({
      url: "https://api.example.com/items",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"name":"test"}',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/items",
      expect.objectContaining({
        method: "POST",
        body: '{"name":"test"}',
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(result).toContain("HTTP 201 Created");
    expect(result).toContain('{"id":1}');
  });

  it("sends custom headers", async () => {
    const mock = createMockResponse({ body: "ok" });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const tools = createHttpTools();
    await tools[0].execute({
      url: "https://api.example.com",
      headers: {
        Authorization: "Bearer token123",
        "X-Custom": "value",
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer token123",
          "X-Custom": "value",
        },
      }),
    );
  });

  it("includes response headers in output", async () => {
    const mock = createMockResponse({
      body: "ok",
      headers: {
        "content-type": "text/plain",
        "x-request-id": "abc123",
      },
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const tools = createHttpTools();
    const result = await tools[0].execute({ url: "https://api.example.com" });

    expect(result).toContain("Response headers:");
    expect(result).toContain("content-type: text/plain");
    expect(result).toContain("x-request-id: abc123");
  });

  it("shows status code and status text", async () => {
    const mock = createMockResponse({
      status: 404,
      statusText: "Not Found",
      body: "not found",
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const tools = createHttpTools();
    const result = await tools[0].execute({ url: "https://api.example.com/missing" });

    expect(result).toContain("HTTP 404 Not Found");
  });

  it("rejects non-http URLs", async () => {
    const tools = createHttpTools();

    await expect(
      tools[0].execute({ url: "ftp://example.com/file" }),
    ).rejects.toThrow("Unsupported protocol: ftp:");

    await expect(
      tools[0].execute({ url: "file:///etc/passwd" }),
    ).rejects.toThrow("Unsupported protocol: file:");
  });

  it("rejects invalid URLs", async () => {
    const tools = createHttpTools();

    await expect(
      tools[0].execute({ url: "not-a-url" }),
    ).rejects.toThrow("Invalid URL");
  });

  it("passes timeout parameter to AbortSignal", async () => {
    const mock = createMockResponse({ body: "ok" });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const tools = createHttpTools();
    await tools[0].execute({
      url: "https://api.example.com",
      timeout: 5000,
    });

    const callOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as RequestInit;
    expect(callOptions.signal).toBeDefined();
  });

  it("does not read body for HEAD requests", async () => {
    const textFn = vi.fn();
    const mock = {
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-length": "1234" }),
      text: textFn,
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const tools = createHttpTools();
    const result = await tools[0].execute({
      url: "https://api.example.com",
      method: "HEAD",
    });

    expect(textFn).not.toHaveBeenCalled();
    expect(result).toContain("HTTP 200 OK");
    expect(result).not.toContain("Body:");
  });

  it("handles network failure", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );

    const tools = createHttpTools();
    await expect(
      tools[0].execute({ url: "https://api.example.com" }),
    ).rejects.toThrow("Network error");
  });

  it("throws when url is missing", async () => {
    const tools = createHttpTools();
    await expect(tools[0].execute({})).rejects.toThrow("url is required");
  });

  it("truncates long response bodies", async () => {
    const longBody = "x".repeat(20_000);
    const mock = createMockResponse({ body: longBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mock);

    const tools = createHttpTools();
    const result = await tools[0].execute({ url: "https://api.example.com" });

    expect(result).toContain("[Truncated");
    expect(result).toContain("20000 chars total");
  });
});
