import { describe, expect, it } from "vitest";
import { parseSSEStream, StreamBufferOverflowError } from "./stream-parser.js";

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

describe("parseSSEStream", () => {
  it("parses single OpenAI-style chunk", async () => {
    const stream = createSSEStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const results: Record<string, unknown>[] = [];
    for await (const obj of parseSSEStream(stream)) {
      results.push(obj);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      choices: [{ delta: { content: "Hello" } }],
    });
  });

  it("parses multiple chunks", async () => {
    const stream = createSSEStream([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const results: Record<string, unknown>[] = [];
    for await (const obj of parseSSEStream(stream)) {
      results.push(obj);
    }

    expect(results).toHaveLength(3);
  });

  it("handles split chunks across network boundaries", async () => {
    // A single SSE message split across two network reads
    const stream = createSSEStream([
      'data: {"choices":[{"del',
      'ta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
    ]);

    const results: Record<string, unknown>[] = [];
    for await (const obj of parseSSEStream(stream)) {
      results.push(obj);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      choices: [{ delta: { content: "Hello" } }],
    });
  });

  it("skips SSE comments", async () => {
    const stream = createSSEStream([
      ": this is a comment\n",
      'data: {"value":1}\n\n',
      "data: [DONE]\n\n",
    ]);

    const results: Record<string, unknown>[] = [];
    for await (const obj of parseSSEStream(stream)) {
      results.push(obj);
    }

    expect(results).toHaveLength(1);
  });

  it("skips empty lines", async () => {
    const stream = createSSEStream([
      "\n\n\n",
      'data: {"value":1}\n\n',
      "data: [DONE]\n\n",
    ]);

    const results: Record<string, unknown>[] = [];
    for await (const obj of parseSSEStream(stream)) {
      results.push(obj);
    }

    expect(results).toHaveLength(1);
  });

  it("handles stream ending without [DONE]", async () => {
    const stream = createSSEStream([
      'data: {"value":1}\n\n',
      'data: {"value":2}\n\n',
    ]);

    const results: Record<string, unknown>[] = [];
    for await (const obj of parseSSEStream(stream)) {
      results.push(obj);
    }

    expect(results).toHaveLength(2);
  });

  it("parses Anthropic-style events", async () => {
    const stream = createSSEStream([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    ]);

    const results: Record<string, unknown>[] = [];
    for await (const obj of parseSSEStream(stream)) {
      results.push(obj);
    }

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty("type", "content_block_delta");
  });

  it("skips non-JSON data lines gracefully", async () => {
    const stream = createSSEStream([
      "data: not-json\n\n",
      'data: {"value":1}\n\n',
      "data: [DONE]\n\n",
    ]);

    const results: Record<string, unknown>[] = [];
    for await (const obj of parseSSEStream(stream)) {
      results.push(obj);
    }

    expect(results).toHaveLength(1);
  });
});
