import { mkdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "./store.js";
import { HistoryManager } from "./history.js";
import { AgentRuntime } from "../agent/runtime.js";
import type { AIProvider } from "../agent/providers.js";
import type {
  CompletionRequest,
  CompletionResponse,
  Message,
} from "../agent/types.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `haya-mem-pipeline-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Capturing provider: records every CompletionRequest.messages[] sent to it,
 * returns canned text responses in order.
 */
function createCapturingProvider(responses?: string[]): {
  provider: AIProvider;
  calls: Message[][];
} {
  const calls: Message[][] = [];
  let callIndex = 0;
  const provider: AIProvider = {
    name: "capturing-mock",
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      calls.push(request.messages.map((m) => ({ ...m })));
      const content = responses?.[callIndex] ?? `Response-${callIndex}`;
      callIndex++;
      return {
        message: { role: "assistant", content, timestamp: Date.now() },
        finishReason: "stop",
      };
    },
  };
  return { provider, calls };
}

/**
 * Replicates the production entry.ts:222-241 chat flow:
 *   1. historyManager.getHistory(sessionKey)
 *   2. runtime.chat({sessionId, message}, history)
 *   3. historyManager.addMessages(sessionKey, [userMsg, assistantMsg])
 */
async function simulateTurn(
  historyManager: HistoryManager,
  runtime: AgentRuntime,
  sessionKey: string,
  message: string,
): Promise<void> {
  const history = historyManager.getHistory(sessionKey);
  const response = await runtime.chat(
    { sessionId: sessionKey, message },
    history,
  );
  historyManager.addMessages(sessionKey, [
    { role: "user", content: message, timestamp: Date.now() },
    response.message,
  ]);
}

describe("Memory Pipeline Integration (Layer 1)", () => {
  let tempDir: string;
  let store: SessionStore;
  let historyManager: HistoryManager;

  beforeEach(() => {
    tempDir = makeTempDir();
    store = new SessionStore(tempDir);
    historyManager = new HistoryManager(store);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("turn 2 sees turn 1 history in provider call", async () => {
    const { provider, calls } = createCapturingProvider([
      "Nice to meet you, Alice!",
      "Yes, you said your name is Alice.",
    ]);
    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    await simulateTurn(historyManager, runtime, "sess-1", "My name is Alice");
    await simulateTurn(
      historyManager,
      runtime,
      "sess-1",
      "Do you remember my name?",
    );

    const turn2 = calls[1];
    expect(turn2).toHaveLength(3);
    expect(turn2[0].role).toBe("user");
    expect(turn2[0].content).toBe("My name is Alice");
    expect(turn2[1].role).toBe("assistant");
    expect(turn2[1].content).toBe("Nice to meet you, Alice!");
    expect(turn2[2].role).toBe("user");
    expect(turn2[2].content).toBe("Do you remember my name?");
  });

  it("5-turn incremental build — provider call 5 has 9 messages", async () => {
    const responses = Array.from({ length: 5 }, (_, i) => `Reply-${i}`);
    const { provider, calls } = createCapturingProvider(responses);
    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    for (let i = 0; i < 5; i++) {
      await simulateTurn(historyManager, runtime, "sess-1", `Turn-${i}`);
    }

    // Turn 5 (index 4): 4 prior pairs (8 msgs) + 1 new user = 9
    expect(calls[4]).toHaveLength(9);
    expect(calls[4][0].content).toBe("Turn-0");
    expect(calls[4][8].content).toBe("Turn-4");
  });

  it("system prompt prepended before history", async () => {
    const { provider, calls } = createCapturingProvider(["R0", "R1"]);
    const runtime = new AgentRuntime(provider, {
      defaultModel: "test",
      systemPrompt: "You are a helpful bot.",
    });

    await simulateTurn(historyManager, runtime, "sess-1", "Hello");
    await simulateTurn(historyManager, runtime, "sess-1", "Again");

    const msgs = calls[1];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are a helpful bot.");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toBe("Hello");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[2].content).toBe("R0");
    expect(msgs[3].role).toBe("user");
    expect(msgs[3].content).toBe("Again");
  });

  it("persistence survives store reconstruction", async () => {
    const { provider } = createCapturingProvider(["Persisted reply"]);
    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    await simulateTurn(historyManager, runtime, "sess-1", "Save me");

    // Destroy and recreate from same directory
    const store2 = new SessionStore(tempDir);
    const hm2 = new HistoryManager(store2);
    const messages = hm2.getHistory("sess-1");

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Save me");
    expect(messages[1].content).toBe("Persisted reply");
  });

  it("HistoryManager auto-creates session on addMessage", () => {
    expect(store.exists("auto-created")).toBe(false);

    historyManager.addMessage("auto-created", {
      role: "user",
      content: "hello",
    });

    expect(store.exists("auto-created")).toBe(true);
    expect(historyManager.getHistory("auto-created")).toHaveLength(1);
  });

  it("truncation: only last maxMessages sent to provider", async () => {
    const maxMessages = 10;
    const hm = new HistoryManager(store, maxMessages);
    const responseList = Array.from({ length: 16 }, (_, i) => `R-${i}`);
    const { provider, calls } = createCapturingProvider(responseList);
    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    // Perform 15 turns (30 messages in store)
    for (let i = 0; i < 15; i++) {
      await simulateTurn(hm, runtime, "trunc-sess", `Msg-${i}`);
    }

    // Turn 16: provider gets maxMessages history + 1 new user = 11
    await simulateTurn(hm, runtime, "trunc-sess", "Final");

    const lastCall = calls[calls.length - 1];
    expect(lastCall).toHaveLength(maxMessages + 1);
    expect(lastCall[lastCall.length - 1].content).toBe("Final");
  });

  it("truncation: all messages still in JSONL store", () => {
    const maxMessages = 10;
    const hm = new HistoryManager(store, maxMessages);

    store.create("full-sess");
    for (let i = 0; i < 15; i++) {
      store.appendMessage("full-sess", { role: "user", content: `U-${i}` });
      store.appendMessage("full-sess", {
        role: "assistant",
        content: `A-${i}`,
      });
    }

    // Store has all 30 messages
    const allMessages = store.readMessages("full-sess");
    expect(allMessages).toHaveLength(30);

    // HistoryManager returns only last 10
    const truncated = hm.getHistory("full-sess");
    expect(truncated).toHaveLength(10);
    // Last 10 of 30 = indices 20-29 = [U-10, A-10, U-11, A-11, U-12, A-12, U-13, A-13, U-14, A-14]
    expect(truncated[0].content).toBe("U-10");
    expect(truncated[9].content).toBe("A-14");
  });

  it("session isolation — two sessions don't cross-contaminate", async () => {
    const { provider, calls } = createCapturingProvider([
      "R-A0",
      "R-B0",
      "R-A1",
      "R-B1",
    ]);
    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    await simulateTurn(historyManager, runtime, "sess-A", "I am Alice");
    await simulateTurn(historyManager, runtime, "sess-B", "I am Bob");
    await simulateTurn(historyManager, runtime, "sess-A", "Who am I?");
    await simulateTurn(historyManager, runtime, "sess-B", "Who am I?");

    // Session A's second turn should only have Alice's history
    const sessACall = calls[2];
    expect(sessACall.some((m) => m.content === "I am Alice")).toBe(true);
    expect(sessACall.some((m) => m.content === "I am Bob")).toBe(false);

    // Session B's second turn should only have Bob's history
    const sessBCall = calls[3];
    expect(sessBCall.some((m) => m.content === "I am Bob")).toBe(true);
    expect(sessBCall.some((m) => m.content === "I am Alice")).toBe(false);
  });

  it("deleting one session doesn't affect another", () => {
    historyManager.addMessage("keep-me", {
      role: "user",
      content: "Important",
    });
    historyManager.addMessage("delete-me", {
      role: "user",
      content: "Disposable",
    });

    store.delete("delete-me");

    expect(store.exists("delete-me")).toBe(false);
    expect(historyManager.getHistory("keep-me")).toHaveLength(1);
    expect(historyManager.getHistory("keep-me")[0].content).toBe("Important");
  });

  it("pruning doesn't corrupt active sessions", () => {
    // Create an "old" session and an "active" session
    historyManager.addMessage("old-sess", {
      role: "user",
      content: "old message",
    });
    historyManager.addMessage("active-sess", {
      role: "user",
      content: "active message",
    });

    // Make old-sess file very old
    const oldPath = join(tempDir, "old-sess.jsonl");
    const pastDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    utimesSync(oldPath, pastDate, pastDate);

    store.prune({ maxAgeDays: 30 });

    expect(store.exists("old-sess")).toBe(false);
    expect(store.exists("active-sess")).toBe(true);

    // Active session reads/writes fine after pruning
    const history = historyManager.getHistory("active-sess");
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("active message");

    historyManager.addMessage("active-sess", {
      role: "assistant",
      content: "reply",
    });
    expect(historyManager.getHistory("active-sess")).toHaveLength(2);
  });

  it("pruning by size preserves newest sessions", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const padding = "x".repeat(200);

    for (const id of ids) {
      store.create(id);
      store.appendMessage(id, { role: "user", content: padding });
    }

    // Set increasing mtimes: p1 oldest, p5 newest
    const now = Date.now();
    for (let i = 0; i < ids.length; i++) {
      const filePath = join(tempDir, `${ids[i]}.jsonl`);
      const time = new Date(now - (ids.length - i) * 60_000);
      utimesSync(filePath, time, time);
    }

    // Get file size (all same since same content)
    const fileSize = statSync(join(tempDir, `${ids[0]}.jsonl`)).size;

    // Allow just enough space for 3 files
    const maxSizeMB = (fileSize * 3 + 1) / (1024 * 1024);
    store.prune({ maxSizeMB });

    // Oldest 2 should be pruned
    expect(store.exists("p1")).toBe(false);
    expect(store.exists("p2")).toBe(false);
    // Newest 3 should survive
    expect(store.exists("p3")).toBe(true);
    expect(store.exists("p4")).toBe(true);
    expect(store.exists("p5")).toBe(true);
  });

  it("edge: empty session returns empty history", () => {
    store.create("empty-sess");
    expect(historyManager.getHistory("empty-sess")).toEqual([]);
  });

  it("edge: special characters (emoji, unicode, newlines, quotes) preserved", async () => {
    const special = 'Hello 🌍!\n"Quoted"\ttab\u00E9\u4E16\u754C';
    const { provider, calls } = createCapturingProvider(["Ack"]);
    const runtime = new AgentRuntime(provider, { defaultModel: "test" });

    await simulateTurn(historyManager, runtime, "special-sess", special);

    // Verify persisted correctly
    const store2 = new SessionStore(tempDir);
    const hm2 = new HistoryManager(store2);
    const history = hm2.getHistory("special-sess");
    expect(history[0].content).toBe(special);

    // Verify provider received it correctly
    expect(calls[0][0].content).toBe(special);
  });

  it("edge: large message content (100KB) preserved", () => {
    const largeContent = "A".repeat(100 * 1024);

    historyManager.addMessage("large-sess", {
      role: "user",
      content: largeContent,
    });

    const store2 = new SessionStore(tempDir);
    const hm2 = new HistoryManager(store2);
    const history = hm2.getHistory("large-sess");

    expect(history).toHaveLength(1);
    expect(history[0].content).toBe(largeContent);
    expect(history[0].content.length).toBe(100 * 1024);
  });

  it("edge: concurrent addMessages to same session", async () => {
    store.create("concurrent-sess");

    // 10 parallel writes
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() =>
          historyManager.addMessage("concurrent-sess", {
            role: "user",
            content: `msg-${i}`,
          }),
        ),
      ),
    );

    const messages = store.readMessages("concurrent-sess");
    expect(messages).toHaveLength(10);

    // All 10 messages should be present (order may vary due to microtask scheduling)
    const contents = new Set(messages.map((m) => m.content));
    for (let i = 0; i < 10; i++) {
      expect(contents.has(`msg-${i}`)).toBe(true);
    }
  });
});
