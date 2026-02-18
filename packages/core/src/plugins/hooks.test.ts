import { describe, it, expect, vi } from "vitest";
import { HookRegistry } from "./hooks.js";

describe("HookRegistry", () => {
  it("registers and dispatches a hook handler", async () => {
    const registry = new HookRegistry();
    const handler = vi.fn();

    registry.register("test-event", handler);
    await registry.dispatch("test-event", { key: "value" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ key: "value" });
  });

  it("dispatches to multiple handlers in order", async () => {
    const registry = new HookRegistry();
    const order: number[] = [];

    registry.register("test-event", async () => {
      order.push(1);
    });
    registry.register("test-event", async () => {
      order.push(2);
    });
    registry.register("test-event", async () => {
      order.push(3);
    });

    await registry.dispatch("test-event", {});
    expect(order).toEqual([1, 2, 3]);
  });

  it("does nothing for unregistered events", async () => {
    const registry = new HookRegistry();
    await expect(
      registry.dispatch("nonexistent", {}),
    ).resolves.not.toThrow();
  });

  it("continues dispatching when a handler throws", async () => {
    const registry = new HookRegistry();
    const handler1 = vi.fn(() => {
      throw new Error("Handler 1 failed");
    });
    const handler2 = vi.fn();

    registry.register("test-event", handler1);
    registry.register("test-event", handler2);

    await registry.dispatch("test-event", {});

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("handles async handlers", async () => {
    const registry = new HookRegistry();
    let value = 0;

    registry.register("async-event", async () => {
      await new Promise((r) => setTimeout(r, 10));
      value = 42;
    });

    await registry.dispatch("async-event", {});
    expect(value).toBe(42);
  });

  it("unregisters all handlers for an event", async () => {
    const registry = new HookRegistry();
    const handler = vi.fn();

    registry.register("test-event", handler);
    registry.unregisterAll("test-event");

    await registry.dispatch("test-event", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("reports correct handler count", () => {
    const registry = new HookRegistry();
    expect(registry.handlerCount("test-event")).toBe(0);

    registry.register("test-event", vi.fn());
    expect(registry.handlerCount("test-event")).toBe(1);

    registry.register("test-event", vi.fn());
    expect(registry.handlerCount("test-event")).toBe(2);
  });

  it("lists all registered events", () => {
    const registry = new HookRegistry();
    registry.register("event-a", vi.fn());
    registry.register("event-b", vi.fn());
    registry.register("event-c", vi.fn());

    const events = registry.events();
    expect(events).toContain("event-a");
    expect(events).toContain("event-b");
    expect(events).toContain("event-c");
    expect(events).toHaveLength(3);
  });

  it("clears all handlers", () => {
    const registry = new HookRegistry();
    registry.register("a", vi.fn());
    registry.register("b", vi.fn());

    registry.clear();

    expect(registry.events()).toHaveLength(0);
    expect(registry.handlerCount("a")).toBe(0);
    expect(registry.handlerCount("b")).toBe(0);
  });

  it("isolates handlers between different events", async () => {
    const registry = new HookRegistry();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    registry.register("event-a", handlerA);
    registry.register("event-b", handlerB);

    await registry.dispatch("event-a", {});

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });
});
