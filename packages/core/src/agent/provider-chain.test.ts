import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FallbackProvider, type ProviderEntry } from "./provider-chain.js";
import { ProviderHealthTracker } from "./provider-health.js";
import type { AIProvider } from "./providers.js";
import type {
  CompletionRequest,
  CompletionResponse,
  StreamDelta,
} from "./types.js";

function makeRequest(model = "gpt-4o"): CompletionRequest {
  return {
    model,
    messages: [{ role: "user", content: "hello" }],
  };
}

function makeResponse(content: string): CompletionResponse {
  return {
    message: { role: "assistant", content },
    finishReason: "stop",
  };
}

function createMockProvider(
  name: string,
  opts?: {
    failComplete?: boolean;
    failStream?: boolean;
    noStream?: boolean;
    content?: string;
  },
): AIProvider {
  const content = opts?.content ?? `response from ${name}`;
  const provider: AIProvider = {
    name,
    complete: opts?.failComplete
      ? vi.fn().mockRejectedValue(new Error(`${name} failed`))
      : vi.fn().mockResolvedValue(makeResponse(content)),
  };

  if (!opts?.noStream) {
    if (opts?.failStream) {
      provider.completeStream = vi.fn(async function* () {
        throw new Error(`${name} stream failed`);
      }) as AIProvider["completeStream"];
    } else {
      provider.completeStream = vi.fn(async function* () {
        yield { content: "chunk1-" } as StreamDelta;
        yield { content: "chunk2" } as StreamDelta;
        return makeResponse(content);
      }) as unknown as AIProvider["completeStream"];
    }
  }

  return provider;
}

describe("FallbackProvider", () => {
  it("throws if no provider entries given", () => {
    expect(() => new FallbackProvider([])).toThrow(
      "at least one provider entry",
    );
  });

  it("names itself after its children", () => {
    const p = new FallbackProvider([
      { provider: createMockProvider("openai") },
      { provider: createMockProvider("anthropic") },
    ]);
    expect(p.name).toBe("fallback(openai,anthropic)");
  });

  describe("complete()", () => {
    it("returns result from first provider on success", async () => {
      const p1 = createMockProvider("openai", { content: "from-openai" });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider([
        { provider: p1 },
        { provider: p2 },
      ]);

      const result = await fb.complete(makeRequest());
      expect(result.message.content).toBe("from-openai");
      expect(p1.complete).toHaveBeenCalledTimes(1);
      expect(p2.complete).not.toHaveBeenCalled();
    });

    it("falls through to second provider when first fails", async () => {
      const p1 = createMockProvider("openai", { failComplete: true });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider([
        { provider: p1 },
        { provider: p2 },
      ]);

      const result = await fb.complete(makeRequest());
      expect(result.message.content).toBe("from-anthropic");
      expect(p1.complete).toHaveBeenCalledTimes(1);
      expect(p2.complete).toHaveBeenCalledTimes(1);
    });

    it("throws last error when all providers fail", async () => {
      const p1 = createMockProvider("openai", { failComplete: true });
      const p2 = createMockProvider("anthropic", { failComplete: true });

      const fb = new FallbackProvider([
        { provider: p1 },
        { provider: p2 },
      ]);

      await expect(fb.complete(makeRequest())).rejects.toThrow(
        "anthropic failed",
      );
    });

    it("routes by model pattern — claude model goes to anthropic first", async () => {
      const p1 = createMockProvider("openai", { content: "from-openai" });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider([
        { provider: p1, models: ["gpt-*", "o1-*"] },
        { provider: p2, models: ["claude-*"] },
      ]);

      const result = await fb.complete(makeRequest("claude-3-opus"));
      expect(result.message.content).toBe("from-anthropic");
      expect(p2.complete).toHaveBeenCalledTimes(1);
      // openai should NOT be called since anthropic succeeded
      expect(p1.complete).not.toHaveBeenCalled();
    });

    it("routes by model pattern — gpt model goes to openai first", async () => {
      const p1 = createMockProvider("openai", { content: "from-openai" });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider([
        { provider: p1, models: ["gpt-*"] },
        { provider: p2, models: ["claude-*"] },
      ]);

      const result = await fb.complete(makeRequest("gpt-4o"));
      expect(result.message.content).toBe("from-openai");
      expect(p1.complete).toHaveBeenCalledTimes(1);
      expect(p2.complete).not.toHaveBeenCalled();
    });

    it("falls back after model-matched provider fails", async () => {
      const p1 = createMockProvider("openai", { failComplete: true });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider([
        { provider: p1, models: ["gpt-*"] },
        { provider: p2, models: ["claude-*"] },
      ]);

      // gpt model matches openai but it fails, should fallback to anthropic
      const result = await fb.complete(makeRequest("gpt-4o"));
      expect(result.message.content).toBe("from-anthropic");
    });

    it("uses exact model match when no wildcard", async () => {
      const p1 = createMockProvider("custom", { content: "from-custom" });
      const p2 = createMockProvider("default", { content: "from-default" });

      const fb = new FallbackProvider([
        { provider: p1, models: ["my-special-model"] },
        { provider: p2 },
      ]);

      const result = await fb.complete(makeRequest("my-special-model"));
      expect(result.message.content).toBe("from-custom");
    });
  });

  describe("completeStream()", () => {
    it("streams from first provider on success", async () => {
      const p1 = createMockProvider("openai", { content: "from-openai" });
      const p2 = createMockProvider("anthropic");

      const fb = new FallbackProvider([
        { provider: p1 },
        { provider: p2 },
      ]);

      const stream = fb.completeStream(makeRequest());
      const chunks: StreamDelta[] = [];
      let finalResult: CompletionResponse | undefined;

      let result = await stream.next();
      while (!result.done) {
        chunks.push(result.value);
        result = await stream.next();
      }
      finalResult = result.value;

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe("chunk1-");
      expect(chunks[1].content).toBe("chunk2");
      expect(finalResult?.message.content).toBe("from-openai");
    });

    it("falls through to second provider when first stream fails", async () => {
      const p1 = createMockProvider("openai", { failStream: true });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider([
        { provider: p1 },
        { provider: p2 },
      ]);

      const stream = fb.completeStream(makeRequest());
      const chunks: StreamDelta[] = [];
      let finalResult: CompletionResponse | undefined;

      let result = await stream.next();
      while (!result.done) {
        chunks.push(result.value);
        result = await stream.next();
      }
      finalResult = result.value;

      expect(chunks).toHaveLength(2);
      expect(finalResult?.message.content).toBe("from-anthropic");
    });

    it("falls back to complete() for provider without streaming", async () => {
      const p1 = createMockProvider("openai", {
        noStream: true,
        content: "from-openai-complete",
      });

      const fb = new FallbackProvider([{ provider: p1 }]);

      const stream = fb.completeStream(makeRequest());
      const chunks: StreamDelta[] = [];
      let finalResult: CompletionResponse | undefined;

      let result = await stream.next();
      while (!result.done) {
        chunks.push(result.value);
        result = await stream.next();
      }
      finalResult = result.value;

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe("from-openai-complete");
      expect(finalResult?.message.content).toBe("from-openai-complete");
    });

    it("throws last error when all streaming providers fail", async () => {
      const p1 = createMockProvider("openai", {
        failStream: true,
        failComplete: true,
      });
      const p2 = createMockProvider("anthropic", {
        failStream: true,
        failComplete: true,
      });

      const fb = new FallbackProvider([
        { provider: p1 },
        { provider: p2 },
      ]);

      const stream = fb.completeStream(makeRequest());
      await expect(stream.next()).rejects.toThrow("anthropic stream failed");
    });
  });

  describe("backward compatibility", () => {
    it("works with a single provider (no fallback needed)", async () => {
      const p1 = createMockProvider("openai", { content: "solo" });
      const fb = new FallbackProvider([{ provider: p1 }]);

      const result = await fb.complete(makeRequest());
      expect(result.message.content).toBe("solo");
    });

    it("works with providers that have no models field", async () => {
      const p1 = createMockProvider("openai", { content: "from-openai" });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider([
        { provider: p1 },
        { provider: p2 },
      ]);

      // Without models, providers are tried in order regardless of model name
      const result = await fb.complete(makeRequest("claude-3-opus"));
      expect(result.message.content).toBe("from-openai");
    });

    it("works without health tracker (no behavior change)", async () => {
      const p1 = createMockProvider("openai", { failComplete: true });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      // No health tracker — old behavior
      const fb = new FallbackProvider([
        { provider: p1 },
        { provider: p2 },
      ]);

      const result = await fb.complete(makeRequest());
      expect(result.message.content).toBe("from-anthropic");
      expect(fb.getHealth()).toBeUndefined();
    });
  });

  describe("health tracking", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("records success when provider completes", async () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      const p1 = createMockProvider("openai", { content: "ok" });

      const fb = new FallbackProvider([{ provider: p1 }], tracker);

      await fb.complete(makeRequest());

      const health = fb.getHealth();
      expect(health).toBeDefined();
      expect(health).toHaveLength(1);
      expect(health![0].providerName).toBe("openai");
      expect(health![0].totalRequests).toBe(1);
      expect(health![0].totalFailures).toBe(0);
      expect(health![0].state).toBe("closed");
    });

    it("records failure when provider throws", async () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      const p1 = createMockProvider("openai", { failComplete: true });
      const p2 = createMockProvider("anthropic", { content: "ok" });

      const fb = new FallbackProvider(
        [{ provider: p1 }, { provider: p2 }],
        tracker,
      );

      await fb.complete(makeRequest());

      const snapshots = fb.getHealth()!;
      const openaiHealth = snapshots.find((s) => s.providerName === "openai")!;
      const anthropicHealth = snapshots.find((s) => s.providerName === "anthropic")!;

      expect(openaiHealth.totalFailures).toBe(1);
      expect(anthropicHealth.totalFailures).toBe(0);
      expect(anthropicHealth.totalRequests).toBe(1);
    });

    it("skips provider when its circuit is open", async () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        recoveryTimeMs: 30_000,
      });
      const p1 = createMockProvider("openai", { failComplete: true });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider(
        [{ provider: p1 }, { provider: p2 }],
        tracker,
      );

      // Fail openai twice to open the circuit
      await fb.complete(makeRequest());
      await fb.complete(makeRequest());

      const openaiHealth = fb.getHealth()!.find((s) => s.providerName === "openai")!;
      expect(openaiHealth.state).toBe("open");

      // Reset mocks to track the next call
      vi.mocked(p1.complete).mockClear();
      vi.mocked(p2.complete).mockClear();

      // Next request should skip openai entirely
      const result = await fb.complete(makeRequest());
      expect(result.message.content).toBe("from-anthropic");
      expect(p1.complete).not.toHaveBeenCalled();
      expect(p2.complete).toHaveBeenCalledTimes(1);
    });

    it("retries provider when circuit transitions to half-open", async () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 2,
        recoveryTimeMs: 30_000,
      });

      // Start with a provider that fails, then we'll make it succeed
      let shouldFail = true;
      const p1: AIProvider = {
        name: "openai",
        complete: vi.fn(async () => {
          if (shouldFail) throw new Error("openai failed");
          return makeResponse("from-openai-recovered");
        }),
      };
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider(
        [{ provider: p1 }, { provider: p2 }],
        tracker,
      );

      // Fail openai twice to open the circuit
      await fb.complete(makeRequest());
      await fb.complete(makeRequest());

      expect(
        fb.getHealth()!.find((s) => s.providerName === "openai")!.state,
      ).toBe("open");

      // Advance past recovery window and make openai succeed
      vi.advanceTimersByTime(30_000);
      shouldFail = false;

      // openai should be tried again (half-open) and succeed
      const result = await fb.complete(makeRequest());
      expect(result.message.content).toBe("from-openai-recovered");

      // Circuit should be closed after success
      expect(
        fb.getHealth()!.find((s) => s.providerName === "openai")!.state,
      ).toBe("closed");
    });

    it("keeps at least one provider even when all circuits are open", async () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 1,
        recoveryTimeMs: 60_000,
      });

      const p1 = createMockProvider("openai", { failComplete: true });
      const p2 = createMockProvider("anthropic", { failComplete: true });

      const fb = new FallbackProvider(
        [{ provider: p1 }, { provider: p2 }],
        tracker,
      );

      // Fail both once to open both circuits
      await expect(fb.complete(makeRequest())).rejects.toThrow();

      // Both circuits are open, but the next call should still try
      // at least one provider (the first in order)
      await expect(fb.complete(makeRequest())).rejects.toThrow();
    });

    it("records health during streaming", async () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      const p1 = createMockProvider("openai", { content: "streamed" });

      const fb = new FallbackProvider([{ provider: p1 }], tracker);

      const stream = fb.completeStream(makeRequest());
      let result = await stream.next();
      while (!result.done) {
        result = await stream.next();
      }

      const health = fb.getHealth()!;
      expect(health).toHaveLength(1);
      expect(health[0].providerName).toBe("openai");
      expect(health[0].totalRequests).toBe(1);
      expect(health[0].totalFailures).toBe(0);
    });

    it("records streaming failure in health tracker", async () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      const p1 = createMockProvider("openai", { failStream: true });
      const p2 = createMockProvider("anthropic", { content: "from-anthropic" });

      const fb = new FallbackProvider(
        [{ provider: p1 }, { provider: p2 }],
        tracker,
      );

      const stream = fb.completeStream(makeRequest());
      let result = await stream.next();
      while (!result.done) {
        result = await stream.next();
      }

      const openaiHealth = fb.getHealth()!.find((s) => s.providerName === "openai")!;
      expect(openaiHealth.totalFailures).toBe(1);
    });

    it("returns health snapshots via getHealth()", async () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      const p1 = createMockProvider("openai");
      const p2 = createMockProvider("anthropic");

      const fb = new FallbackProvider(
        [{ provider: p1 }, { provider: p2 }],
        tracker,
      );

      await fb.complete(makeRequest());

      const health = fb.getHealth()!;
      expect(health).toHaveLength(1); // only openai was tried (it succeeded)
      expect(health[0].providerName).toBe("openai");
      expect(health[0].state).toBe("closed");
    });
  });
});
