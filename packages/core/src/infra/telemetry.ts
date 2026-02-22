import { trace, metrics, type Tracer, type Meter } from "@opentelemetry/api";

let initialized = false;

export interface TelemetryConfig {
  enabled: boolean;
  serviceName?: string;
  otlp?: {
    endpoint: string;
    headersEnvVar?: string;
  };
}

export async function initTelemetry(config: TelemetryConfig): Promise<void> {
  if (!config.enabled || initialized) return;

  // Dynamic import to avoid loading OTel when disabled
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
  const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
  const { Resource } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName ?? "haya",
  });

  const headers: Record<string, string> = {};
  if (config.otlp?.headersEnvVar) {
    const headerStr = process.env[config.otlp.headersEnvVar];
    if (headerStr) {
      // Parse "key=value,key2=value2" format
      for (const pair of headerStr.split(",")) {
        const [k, v] = pair.split("=", 2);
        if (k && v) headers[k.trim()] = v.trim();
      }
    }
  }

  const traceExporter = config.otlp ? new OTLPTraceExporter({
    url: `${config.otlp.endpoint}/v1/traces`,
    headers,
  }) : undefined;

  const metricExporter = config.otlp ? new OTLPMetricExporter({
    url: `${config.otlp.endpoint}/v1/metrics`,
    headers,
  }) : undefined;

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    ...(metricExporter && {
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 30000,
      }),
    }),
  });

  sdk.start();
  initialized = true;

  // Register shutdown handler
  process.on("SIGTERM", () => sdk.shutdown());
}

export function getTracer(name: string = "haya"): Tracer {
  return trace.getTracer(name);
}

export function getMeter(name: string = "haya"): Meter {
  return metrics.getMeter(name);
}

export function shutdownTelemetry(): Promise<void> {
  // SDK shutdown is handled by the SIGTERM handler
  return Promise.resolve();
}
