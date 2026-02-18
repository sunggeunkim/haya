import { describe, expect, it } from "vitest";
import {
  GatewayEventSchema,
  GatewayFrameSchema,
  GatewayRequestSchema,
  GatewayResponseSchema,
} from "./schema.js";

describe("GatewayRequestSchema", () => {
  it("accepts a valid request", () => {
    const result = GatewayRequestSchema.safeParse({
      id: "req-1",
      method: "chat.send",
      params: { message: "hello" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a request without params", () => {
    const result = GatewayRequestSchema.safeParse({
      id: "req-2",
      method: "sessions.list",
    });
    expect(result.success).toBe(true);
  });

  it("rejects request with empty id", () => {
    const result = GatewayRequestSchema.safeParse({
      id: "",
      method: "chat.send",
    });
    expect(result.success).toBe(false);
  });

  it("rejects request with empty method", () => {
    const result = GatewayRequestSchema.safeParse({
      id: "req-3",
      method: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects request without id", () => {
    const result = GatewayRequestSchema.safeParse({
      method: "chat.send",
    });
    expect(result.success).toBe(false);
  });

  it("rejects request without method", () => {
    const result = GatewayRequestSchema.safeParse({
      id: "req-4",
    });
    expect(result.success).toBe(false);
  });

  it("rejects overly long id", () => {
    const result = GatewayRequestSchema.safeParse({
      id: "x".repeat(129),
      method: "test",
    });
    expect(result.success).toBe(false);
  });
});

describe("GatewayResponseSchema", () => {
  it("accepts a success response", () => {
    const result = GatewayResponseSchema.safeParse({
      id: "req-1",
      result: { data: "ok" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an error response", () => {
    const result = GatewayResponseSchema.safeParse({
      id: "req-1",
      error: { code: -32600, message: "Invalid request" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects response without id", () => {
    const result = GatewayResponseSchema.safeParse({
      result: "ok",
    });
    expect(result.success).toBe(false);
  });
});

describe("GatewayEventSchema", () => {
  it("accepts a valid event", () => {
    const result = GatewayEventSchema.safeParse({
      event: "chat.chunk",
      data: { text: "hello" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects event without event name", () => {
    const result = GatewayEventSchema.safeParse({
      data: "something",
    });
    expect(result.success).toBe(false);
  });
});

describe("GatewayFrameSchema", () => {
  it("accepts a request frame", () => {
    const result = GatewayFrameSchema.safeParse({
      id: "req-1",
      method: "test",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a response frame", () => {
    const result = GatewayFrameSchema.safeParse({
      id: "req-1",
      result: "ok",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an event frame", () => {
    const result = GatewayFrameSchema.safeParse({
      event: "test",
      data: null,
    });
    expect(result.success).toBe(true);
  });
});
