import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderHealthTracker } from "./provider-health.js";
import type { ProviderHealthSnapshot } from "./provider-health.js";

describe("ProviderHealthTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("starts in closed state for unknown providers", () => {
      const tracker = new ProviderHealthTracker();
      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.state).toBe("closed");
      expect(snapshot.consecutiveFailures).toBe(0);
      expect(snapshot.totalRequests).toBe(0);
      expect(snapshot.totalFailures).toBe(0);
    });

    it("considers unknown providers as available", () => {
      const tracker = new ProviderHealthTracker();
      expect(tracker.isAvailable("openai")).toBe(true);
    });
  });

  describe("closed state", () => {
    it("stays closed after successes", () => {
      const tracker = new ProviderHealthTracker();
      tracker.recordSuccess("openai");
      tracker.recordSuccess("openai");

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.state).toBe("closed");
      expect(snapshot.totalRequests).toBe(2);
      expect(snapshot.totalFailures).toBe(0);
    });

    it("stays closed when failures are below threshold", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.state).toBe("closed");
      expect(snapshot.consecutiveFailures).toBe(2);
    });

    it("resets consecutive failures on success", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordSuccess("openai");

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.state).toBe("closed");
      expect(snapshot.consecutiveFailures).toBe(0);
    });

    it("is available when circuit is closed", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      expect(tracker.isAvailable("openai")).toBe(true);
    });
  });

  describe("closed -> open transition", () => {
    it("opens after consecutive failures reach threshold", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.state).toBe("open");
      expect(snapshot.consecutiveFailures).toBe(3);
      expect(snapshot.openedAt).toBeDefined();
    });

    it("is unavailable when circuit is open", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 3 });
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      expect(tracker.isAvailable("openai")).toBe(false);
    });

    it("opens with custom threshold", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 5 });
      for (let i = 0; i < 4; i++) {
        tracker.recordFailure("openai");
      }
      expect(tracker.getSnapshot("openai").state).toBe("closed");

      tracker.recordFailure("openai");
      expect(tracker.getSnapshot("openai").state).toBe("open");
    });

    it("uses default threshold of 3", () => {
      const tracker = new ProviderHealthTracker();
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      expect(tracker.getSnapshot("openai").state).toBe("closed");

      tracker.recordFailure("openai");
      expect(tracker.getSnapshot("openai").state).toBe("open");
    });
  });

  describe("open -> half-open transition", () => {
    it("stays open during recovery period", () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        recoveryTimeMs: 30_000,
      });

      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      // Advance 15 seconds — still within recovery window
      vi.advanceTimersByTime(15_000);

      expect(tracker.isAvailable("openai")).toBe(false);
      expect(tracker.getSnapshot("openai").state).toBe("open");
    });

    it("transitions to half-open after recovery period via isAvailable", () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        recoveryTimeMs: 30_000,
      });

      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      // Advance past recovery window
      vi.advanceTimersByTime(30_000);

      expect(tracker.isAvailable("openai")).toBe(true);
      // After isAvailable transitions to half-open, snapshot should reflect it
      expect(tracker.getSnapshot("openai").state).toBe("half-open");
    });

    it("transitions to half-open after recovery period via getSnapshot", () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        recoveryTimeMs: 30_000,
      });

      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      vi.advanceTimersByTime(30_000);

      // getSnapshot should also see the half-open state
      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.state).toBe("half-open");
    });
  });

  describe("half-open -> closed transition", () => {
    it("closes on success during half-open", () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        recoveryTimeMs: 30_000,
      });

      // Open the circuit
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      expect(tracker.getSnapshot("openai").state).toBe("open");

      // Wait for recovery
      vi.advanceTimersByTime(30_000);
      expect(tracker.isAvailable("openai")).toBe(true); // transitions to half-open

      // Probe succeeds
      tracker.recordSuccess("openai");

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.state).toBe("closed");
      expect(snapshot.consecutiveFailures).toBe(0);
      expect(snapshot.openedAt).toBeUndefined();
    });
  });

  describe("half-open -> open transition", () => {
    it("re-opens on failure during half-open", () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        recoveryTimeMs: 30_000,
      });

      // Open the circuit
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      // Wait for recovery
      vi.advanceTimersByTime(30_000);
      expect(tracker.isAvailable("openai")).toBe(true); // half-open

      // Probe fails
      tracker.recordFailure("openai");

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.state).toBe("open");
      expect(snapshot.openedAt).toBeDefined();
    });

    it("is unavailable again after half-open failure", () => {
      const tracker = new ProviderHealthTracker({
        failureThreshold: 3,
        recoveryTimeMs: 30_000,
      });

      // Open the circuit
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      // Wait for recovery
      vi.advanceTimersByTime(30_000);
      tracker.isAvailable("openai"); // transitions to half-open

      // Probe fails
      tracker.recordFailure("openai");

      expect(tracker.isAvailable("openai")).toBe(false);
    });
  });

  describe("statistics tracking", () => {
    it("records total requests and failures correctly", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 5 });
      tracker.recordSuccess("openai");
      tracker.recordSuccess("openai");
      tracker.recordFailure("openai");
      tracker.recordSuccess("openai");
      tracker.recordFailure("openai");

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.totalRequests).toBe(5);
      expect(snapshot.totalFailures).toBe(2);
      expect(snapshot.consecutiveFailures).toBe(1);
    });

    it("records last failure and success timestamps", () => {
      const tracker = new ProviderHealthTracker();

      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      tracker.recordSuccess("openai");

      vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
      tracker.recordFailure("openai");

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.lastSuccessAt).toBe(
        new Date("2026-01-01T00:00:00Z").getTime(),
      );
      expect(snapshot.lastFailureAt).toBe(
        new Date("2026-01-01T00:01:00Z").getTime(),
      );
    });

    it("tracks multiple providers independently", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });

      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordSuccess("anthropic");

      expect(tracker.getSnapshot("openai").state).toBe("open");
      expect(tracker.getSnapshot("anthropic").state).toBe("closed");
    });
  });

  describe("getAll()", () => {
    it("returns snapshots for all tracked providers", () => {
      const tracker = new ProviderHealthTracker();
      tracker.recordSuccess("openai");
      tracker.recordFailure("anthropic");

      const snapshots = tracker.getAll();
      expect(snapshots).toHaveLength(2);

      const names = snapshots.map((s: ProviderHealthSnapshot) => s.providerName);
      expect(names).toContain("openai");
      expect(names).toContain("anthropic");
    });

    it("returns empty array when no providers tracked", () => {
      const tracker = new ProviderHealthTracker();
      expect(tracker.getAll()).toHaveLength(0);
    });
  });

  describe("reset()", () => {
    it("resets a single provider", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("anthropic");

      tracker.reset("openai");

      expect(tracker.getSnapshot("openai").state).toBe("closed");
      expect(tracker.getSnapshot("openai").totalRequests).toBe(0);
      expect(tracker.getSnapshot("anthropic").totalRequests).toBe(1);
    });

    it("resets all providers when called without argument", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("anthropic");

      tracker.reset();

      expect(tracker.getAll()).toHaveLength(0);
      expect(tracker.getSnapshot("openai").state).toBe("closed");
      expect(tracker.getSnapshot("anthropic").state).toBe("closed");
    });

    it("makes provider available again after reset", () => {
      const tracker = new ProviderHealthTracker({ failureThreshold: 2 });
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");

      expect(tracker.isAvailable("openai")).toBe(false);

      tracker.reset("openai");
      expect(tracker.isAvailable("openai")).toBe(true);
    });
  });

  describe("recordFailure with error parameter", () => {
    it("accepts an optional error parameter", () => {
      const tracker = new ProviderHealthTracker();
      const error = new Error("connection reset");

      tracker.recordFailure("openai", error);

      const snapshot = tracker.getSnapshot("openai");
      expect(snapshot.totalFailures).toBe(1);
    });
  });
});
