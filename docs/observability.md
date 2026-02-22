# Observability

Haya integrates with OpenTelemetry (OTel) for distributed tracing and metrics. When disabled (the default), no OTel packages are loaded and there is zero runtime overhead.

## Configuration

Add the `observability` block to `haya.config.yaml`:

```yaml
observability:
  enabled: true
  serviceName: haya            # optional, defaults to "haya"
  otlp:
    endpoint: http://localhost:4318   # OTLP/HTTP base URL
    headersEnvVar: OTEL_HEADERS       # optional env var name (see below)
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `observability.enabled` | boolean | `false` | Enable or disable telemetry collection |
| `observability.serviceName` | string | `"haya"` | The `service.name` resource attribute in all exported spans and metrics |
| `observability.otlp.endpoint` | string | -- | Base URL of an OTLP/HTTP collector (e.g. `http://localhost:4318`) |
| `observability.otlp.headersEnvVar` | string | -- | Name of an environment variable containing OTLP headers in `key=value,key2=value2` format |

### OTLP headers (authentication)

For security, OTLP authentication headers are never stored in the config file as plain text. Instead, specify the **name** of an environment variable that contains the headers:

```yaml
observability:
  otlp:
    endpoint: https://otel.example.com
    headersEnvVar: OTEL_HEADERS
```

Then set the environment variable:

```bash
export OTEL_HEADERS="Authorization=Bearer tok_abc123,X-Custom=value"
```

The header string is parsed as comma-separated `key=value` pairs and sent with every OTLP export request.

## How it works

1. When `observability.enabled` is `false` (default), the telemetry module returns immediately. No OTel SDK packages are imported.
2. When `observability.enabled` is `true`, the following packages are **dynamically imported** at startup:
   - `@opentelemetry/sdk-node`
   - `@opentelemetry/exporter-trace-otlp-http`
   - `@opentelemetry/exporter-metrics-otlp-http`
   - `@opentelemetry/sdk-metrics`
   - `@opentelemetry/resources`
   - `@opentelemetry/semantic-conventions`
3. The `NodeSDK` is initialized with an OTLP/HTTP trace exporter and a `PeriodicExportingMetricReader` (export interval: 30 seconds).
4. A `SIGTERM` handler is registered to gracefully shut down the SDK and flush pending telemetry.

## Exported telemetry

### Trace spans

| Span name | Description |
|-----------|-------------|
| `haya.chat` | End-to-end span for a `chat.send` request, including tool loops |
| `haya.provider.complete` | A single LLM provider completion call |
| `haya.tool.execute` | Execution of one tool invocation |

### Metrics

Metrics are exported via OTLP/HTTP to `{endpoint}/v1/metrics`. The periodic exporter flushes every 30 seconds.

## Example configurations

### Jaeger (local development)

Jaeger's OTLP collector listens on port 4318 by default:

```yaml
observability:
  enabled: true
  otlp:
    endpoint: http://localhost:4318
```

Run Jaeger with OTLP enabled:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

View traces at `http://localhost:16686`.

### Grafana Cloud

```yaml
observability:
  enabled: true
  serviceName: haya-prod
  otlp:
    endpoint: https://otlp-gateway-prod-us-central-0.grafana.net/otlp
    headersEnvVar: GRAFANA_OTEL_HEADERS
```

```bash
export GRAFANA_OTEL_HEADERS="Authorization=Basic <base64-encoded-instance-id:token>"
```

### Grafana Alloy / OpenTelemetry Collector (self-hosted)

Point to your collector's OTLP/HTTP receiver:

```yaml
observability:
  enabled: true
  otlp:
    endpoint: http://otel-collector:4318
```
