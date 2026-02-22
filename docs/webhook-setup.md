# Webhook Integration Setup

Guide for connecting external services to Haya via generic HTTP webhooks.

## Overview

The Webhook integration provides a generic HTTP endpoint that accepts JSON payloads, which means:
- Any service that can send HTTP POST requests can integrate with Haya
- Optional HMAC signature verification for authenticating webhook sources
- Inbound-only -- the webhook channel does not support outbound messages

## Prerequisites

- A service or script that can send HTTP POST requests
- Haya installed and running

## Step 1: Configure Haya

The webhook channel works with zero configuration. By default it listens on port 9090 at the `/webhook` path.

To customize, add settings to your Haya config file:

```json
{
  "channels": {
    "webhook": {
      "port": 9090,
      "path": "/webhook",
      "maxPayloadBytes": 1048576
    }
  }
}
```

## Step 2: Start Haya

```bash
pnpm dev start
```

The Webhook channel will start an HTTP server and begin listening for POST requests.

## Step 3: Send a test message

```bash
curl -X POST http://localhost:9090/webhook \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from webhook", "senderId": "test-user", "source": "my-app"}'
```

## How it works

### Payload format

The webhook expects a JSON body with these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | The message text |
| `senderId` | string | No | Identifier for the sender (defaults to `"webhook"`) |
| `source` | string | No | Name of the source system (defaults to the matched source name, or `"unknown"`) |

If the body is valid JSON but does not have a `content` field, the entire payload is stringified and used as the content.

### HMAC signature verification

You can configure named webhook sources with HMAC secrets for authentication. When sources are configured, every incoming request must include a valid `X-Hub-Signature-256` header.

Add sources to your config:

```json
{
  "channels": {
    "webhook": {
      "sources": [
        {
          "name": "github",
          "secretEnvVar": "WEBHOOK_SECRET_GITHUB"
        },
        {
          "name": "monitoring",
          "secretEnvVar": "WEBHOOK_SECRET_MONITORING"
        }
      ]
    }
  }
}
```

Then set the corresponding environment variables in your `.env` file:

```bash
WEBHOOK_SECRET_GITHUB=your-github-webhook-secret
WEBHOOK_SECRET_MONITORING=your-monitoring-webhook-secret
```

The signature header format is `sha256=<hex-digest>`. The plugin uses timing-safe comparison to prevent timing attacks. When multiple sources are configured, the plugin tries each secret until one matches.

If no sources are configured, signature verification is skipped and all POST requests are accepted.

### Session routing

Messages are routed to sessions based on the source name:
- **All messages**: Session key is `webhook:<source>`

All messages from the same source share a single session.

### Prompt injection protection

All inbound webhook payloads are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `9090` | Port for the HTTP server |
| `path` | `/webhook` | URL path for the endpoint |
| `maxPayloadBytes` | `1048576` (1 MB) | Maximum request body size |
| `sources` | `[]` | Array of named sources with HMAC secrets |

## Troubleshooting

### HTTP 404 "Not found"

The request URL does not match the configured path. By default, POST to `/webhook`.

### HTTP 401 "Invalid signature"

1. Sources are configured but the request does not include a valid `X-Hub-Signature-256` header
2. Verify the secret in your `.env` file matches the secret configured in the sending service
3. Ensure the signature is computed over the raw request body using HMAC-SHA256

### HTTP 413 "Payload too large"

The request body exceeds `maxPayloadBytes` (default: 1 MB). Increase the limit in your config if needed.

### No outbound responses

The webhook channel is inbound-only. It does not support sending replies back to the source. If you need bidirectional communication, use a different channel or implement a callback URL in your application.
