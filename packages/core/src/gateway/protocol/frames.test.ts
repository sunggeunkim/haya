import { describe, expect, it } from "vitest";
import {
  buildErrorResponse,
  buildEvent,
  buildResponse,
  parseRequest,
  serializeFrame,
} from "./frames.js";
import { ErrorCodes } from "./types.js";

describe("parseRequest", () => {
  it("parses valid JSON-RPC request", () => {
    const raw = JSON.stringify({ id: "1", method: "chat.send", params: { text: "hi" } });
    const result = parseRequest(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.id).toBe("1");
      expect(result.request.method).toBe("chat.send");
      expect(result.request.params).toEqual({ text: "hi" });
    }
  });

  it("parses request without params", () => {
    const raw = JSON.stringify({ id: "2", method: "sessions.list" });
    const result = parseRequest(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.params).toBeUndefined();
    }
  });

  it("returns PARSE_ERROR for invalid JSON", () => {
    const result = parseRequest("not json{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.PARSE_ERROR);
    }
  });

  it("returns INVALID_REQUEST for missing id", () => {
    const result = parseRequest(JSON.stringify({ method: "test" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_REQUEST);
    }
  });

  it("returns INVALID_REQUEST for missing method", () => {
    const result = parseRequest(JSON.stringify({ id: "1" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_REQUEST);
    }
  });
});

describe("buildResponse", () => {
  it("builds a success response", () => {
    const response = buildResponse("req-1", { data: "ok" });
    expect(response.id).toBe("req-1");
    expect(response.result).toEqual({ data: "ok" });
    expect(response.error).toBeUndefined();
  });
});

describe("buildErrorResponse", () => {
  it("builds an error response", () => {
    const response = buildErrorResponse("req-1", -32600, "Invalid");
    expect(response.id).toBe("req-1");
    expect(response.error?.code).toBe(-32600);
    expect(response.error?.message).toBe("Invalid");
    expect(response.result).toBeUndefined();
  });
});

describe("buildEvent", () => {
  it("builds an event frame", () => {
    const event = buildEvent("chat.chunk", { text: "hello" });
    expect(event.event).toBe("chat.chunk");
    expect(event.data).toEqual({ text: "hello" });
  });
});

describe("serializeFrame", () => {
  it("serializes to JSON", () => {
    const frame = { id: "1", result: "ok" };
    const json = serializeFrame(frame);
    expect(JSON.parse(json)).toEqual(frame);
  });
});
