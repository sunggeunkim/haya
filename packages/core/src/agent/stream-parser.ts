/**
 * SSE (Server-Sent Events) stream parser for AI provider streaming responses.
 * Parses `data: {...}\n\n` lines from a ReadableStream into JSON objects.
 */

const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB

export class StreamBufferOverflowError extends Error {
  constructor() {
    super("SSE stream buffer exceeded 1MB limit");
    this.name = "StreamBufferOverflowError";
  }
}

/**
 * Parse an SSE stream from a ReadableStream<Uint8Array>.
 * Yields parsed JSON objects from `data:` lines.
 * Terminates on `data: [DONE]` (OpenAI convention).
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (buffer.length > MAX_BUFFER_SIZE) {
        throw new StreamBufferOverflowError();
      }

      // Process complete lines
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith(":")) continue;

        // Parse data lines
        if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();

          // OpenAI convention: end of stream
          if (payload === "[DONE]") return;

          try {
            yield JSON.parse(payload) as Record<string, unknown>;
          } catch {
            // Skip non-JSON data lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
