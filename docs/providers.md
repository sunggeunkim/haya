# Providers

Haya supports multiple AI providers through a unified abstraction. Providers are configured declaratively in `haya.config.yaml` and resolved at runtime. API keys are always read from environment variables, never stored in config.

## Supported providers

| Provider | `defaultProvider` value | API format | Auth |
|----------|------------------------|------------|------|
| OpenAI | `openai` | OpenAI Chat Completions | `Authorization: Bearer` via env var |
| Anthropic | `anthropic` | Anthropic Messages API | `x-api-key` via env var |
| AWS Bedrock | `bedrock` | Bedrock Converse API | AWS credentials (standard SDK chain) |
| OpenAI-compatible | any custom name | OpenAI Chat Completions | `Authorization: Bearer` via env var |

### OpenAI

Uses `https://api.openai.com/v1` by default. Set `defaultProviderApiKeyEnvVar` (or per-entry `apiKeyEnvVar`) to the name of the env var holding your API key.

```yaml
agent:
  defaultProvider: openai
  defaultModel: gpt-4o
  defaultProviderApiKeyEnvVar: OPENAI_API_KEY
```

### Anthropic

Uses `https://api.anthropic.com/v1` by default. System messages are extracted and sent via the `system` parameter. Tool calls use Anthropic's `tool_use` / `tool_result` content block format.

```yaml
agent:
  defaultProvider: anthropic
  defaultModel: claude-sonnet-4-20250514
  defaultProviderApiKeyEnvVar: ANTHROPIC_API_KEY
```

### AWS Bedrock

Uses the Bedrock Converse and ConverseStream APIs. The AWS SDK (`@aws-sdk/client-bedrock-runtime`) is **lazy-loaded** -- users who do not use Bedrock do not need it installed.

Authentication uses the standard AWS credential chain (environment variables, IAM roles, SSO profiles, etc.). No `apiKeyEnvVar` is needed.

```yaml
agent:
  defaultProvider: bedrock
  defaultModel: us.anthropic.claude-sonnet-4-20250514-v1:0
  awsRegion: us-east-1
```

The region is resolved in this order: `awsRegion` config field, `AWS_REGION` env var, `AWS_DEFAULT_REGION` env var, then `us-east-1` as the fallback.

Retryable Bedrock errors (`ThrottlingException`, `ServiceUnavailableException`, `ModelTimeoutException`) are wrapped into the standard retry mechanism automatically.

### OpenAI-compatible (custom baseUrl)

Any provider that exposes an OpenAI-compatible `/chat/completions` endpoint can be used by specifying a `baseUrl` in the provider chain:

```yaml
agent:
  providers:
    - name: local-llm
      apiKeyEnvVar: LOCAL_LLM_KEY
      baseUrl: http://localhost:8080/v1
      models: ["llama-*"]
```

## Provider configuration

The basic provider is set with three fields under `agent`:

```yaml
agent:
  defaultProvider: openai       # provider name
  defaultModel: gpt-4o          # default model for requests
  defaultProviderApiKeyEnvVar: OPENAI_API_KEY
```

## Provider fallback chain

For high availability, configure multiple providers in a fallback chain. The chain supports model-pattern routing so requests are directed to the right provider, with automatic fallback when a provider fails.

```yaml
agent:
  defaultModel: gpt-4o
  providers:
    - name: openai
      apiKeyEnvVar: OPENAI_API_KEY
      models: ["gpt-*", "o1-*"]
    - name: anthropic
      apiKeyEnvVar: ANTHROPIC_API_KEY
      models: ["claude-*"]
    - name: local-fallback
      apiKeyEnvVar: LOCAL_KEY
      baseUrl: http://localhost:8080/v1
```

### Provider entry schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Provider name (`openai`, `anthropic`, `bedrock`, or custom) |
| `apiKeyEnvVar` | string | Yes | Environment variable containing the API key |
| `baseUrl` | string | No | Custom API base URL (required for unknown provider names) |
| `models` | string[] | No | Glob-style model patterns for routing (e.g. `["gpt-*"]`) |

### Routing logic

1. When a `chat.send` request specifies a model (or the `defaultModel` is used), the chain checks each provider's `models` patterns.
2. Providers whose patterns match the requested model are tried first.
3. On failure, the remaining providers are tried in declaration order.
4. If all providers fail, the last error is thrown.

Pattern matching uses trailing-wildcard globs: `gpt-*` matches `gpt-4o`, `gpt-4o-mini`, etc. Exact matches are also supported.

## Retry with exponential backoff

All provider HTTP calls (OpenAI, Anthropic) and Bedrock SDK calls are wrapped with automatic retry logic.

### Default retry settings

| Setting | Default | Description |
|---------|---------|-------------|
| `maxRetries` | 3 | Maximum number of retry attempts |
| `initialDelayMs` | 1000 | Delay before the first retry (ms) |
| `maxDelayMs` | 8000 | Maximum delay between retries (ms) |
| `backoffMultiplier` | 2 | Multiplier applied to delay each attempt |

### Retryable errors

**HTTP status codes:**

| Code | Meaning |
|------|---------|
| 429 | Rate limited (too many requests) |
| 503 | Service unavailable |

**Network error codes:**

| Code | Meaning |
|------|---------|
| `ECONNRESET` | Connection reset by peer |
| `ETIMEDOUT` | Connection timed out |
| `ECONNREFUSED` | Connection refused |
| `UND_ERR_CONNECT_TIMEOUT` | Undici connect timeout |
| `UND_ERR_SOCKET` | Undici socket error |

**Bedrock-specific exceptions** (automatically wrapped as retryable):
- `ThrottlingException`
- `ServiceUnavailableException`
- `ModelTimeoutException`

### Retry-After header

When a provider returns a `Retry-After` response header (common with 429 responses), Haya respects it. The header value is parsed as either seconds or an HTTP-date. The actual delay is capped at `maxDelayMs`.

### Non-retryable errors

Any HTTP error not in the retryable set (e.g. 400 Bad Request, 401 Unauthorized) is thrown immediately without retry.

## Response streaming

Haya supports streaming responses from all providers. When the gateway receives a `chat.send` request, it opens a streaming connection to the provider and relays incremental text via `chat.delta` WebSocket events.

### OpenAI / OpenAI-compatible streaming

Requests are sent with `stream: true`. The response is an SSE stream of `data: {...}` lines. Each chunk contains `choices[0].delta.content` with an incremental text fragment. The stream terminates with `data: [DONE]`.

### Anthropic streaming

Requests are sent with `stream: true`. The response uses Anthropic's event types:
- `message_start` -- contains initial usage (input tokens)
- `content_block_start` -- signals start of a text or tool_use block
- `content_block_delta` -- contains `text_delta` or `input_json_delta` fragments
- `message_delta` -- contains `stop_reason` and final output token count

### Bedrock streaming

Uses the `ConverseStream` API. Events include:
- `contentBlockStart` -- signals start of text or tool_use block
- `contentBlockDelta` -- contains text or tool input fragments
- `messageStop` -- contains the stop reason
- `metadata` -- contains final usage statistics

### SSE parser

All HTTP-based streaming (OpenAI, Anthropic) uses a shared SSE parser that reads `data:` lines from a `ReadableStream<Uint8Array>`, handles the `[DONE]` sentinel, and enforces a 1 MB buffer limit to prevent memory issues from malformed streams.
