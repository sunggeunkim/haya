import { describe, expect, it } from "vitest";
import { trace, metrics } from "@opentelemetry/api";
import { getTracer, getMeter, initTelemetry } from "./telemetry.js";

describe("telemetry", () => {
  it("getTracer returns a Tracer object", () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
    expect(typeof tracer.startActiveSpan).toBe("function");
  });

  it("getTracer accepts a custom name", () => {
    const tracer = getTracer("custom-tracer");
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
  });

  it("getMeter returns a Meter object", () => {
    const meter = getMeter();
    expect(meter).toBeDefined();
    expect(typeof meter.createCounter).toBe("function");
    expect(typeof meter.createHistogram).toBe("function");
    expect(typeof meter.createUpDownCounter).toBe("function");
  });

  it("getMeter accepts a custom name", () => {
    const meter = getMeter("custom-meter");
    expect(meter).toBeDefined();
    expect(typeof meter.createCounter).toBe("function");
  });

  it("initTelemetry with enabled: false is a no-op", async () => {
    // Should resolve without error and not initialize anything
    await expect(
      initTelemetry({ enabled: false }),
    ).resolves.toBeUndefined();
  });

  it("@opentelemetry/api exports are available", () => {
    expect(trace).toBeDefined();
    expect(metrics).toBeDefined();
    expect(typeof trace.getTracer).toBe("function");
    expect(typeof metrics.getMeter).toBe("function");
  });
});
