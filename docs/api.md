# Gateway API Reference

The Haya gateway exposes a JSON-RPC-style protocol over WebSocket.

## Connection

```
ws://localhost:18789/ws
wss://your-host:18789/ws  (with TLS)
```

### Authentication

All connections require authentication. Pass the token as a Bearer token in the WebSocket upgrade request:

```
Authorization: Bearer <your-token>
```

Or as a query parameter:

```
ws://localhost:18789/ws?token=<your-token>
```

## Protocol

### Request

```json
{
  "id": "unique-request-id",
  "method": "method.name",
  "params": { ... }
}
```

### Response

Success:

```json
{
  "id": "unique-request-id",
  "result": { ... }
}
```

Error:

```json
{
  "id": "unique-request-id",
  "error": {
    "code": -32601,
    "message": "Method not found"
  }
}
```

### Server-sent events

The server can push events at any time:

```json
{
  "event": "event.name",
  "data": { ... }
}
```

### Error codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | PARSE_ERROR | Invalid JSON |
| -32600 | INVALID_REQUEST | Missing required fields |
| -32601 | METHOD_NOT_FOUND | Unknown method |
| -32602 | INVALID_PARAMS | Params failed Zod validation |
| -32603 | INTERNAL_ERROR | Server error |
| -32000 | AUTH_REQUIRED | Authentication failed |
| -32001 | RATE_LIMITED | Too many requests |
| -32001 | BUDGET_EXCEEDED | Token or request budget exceeded (HTTP 429) |

## Methods

### chat.send

Send a message and get an AI response.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Session to send message in |
| `message` | string | Yes | User message content |
| `model` | string | No | Override the default AI model |
| `systemPrompt` | string | No | Override the system prompt |

**Streaming:** While the AI generates its response, the server pushes `chat.delta` events over the WebSocket so clients can display partial output in real time. Each delta event has this format:

```json
{
  "event": "chat.delta",
  "data": {
    "sessionId": "abc123",
    "delta": "Hello",
    "done": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | The session this delta belongs to |
| `delta` | string | Incremental text fragment |
| `done` | boolean | `true` on the final chunk, `false` otherwise |

Deltas are best-effort; the final complete response is always returned as the standard RPC response frame below.

**Result:**

```json
{
  "sessionId": "abc123",
  "message": {
    "role": "assistant",
    "content": "Hello! How can I help you?",
    "timestamp": 1708300000000
  },
  "usage": {
    "promptTokens": 50,
    "completionTokens": 20,
    "totalTokens": 70
  }
}
```

**Errors:** If the session has exceeded its configured budget limits, the server returns a `BudgetExceededError` instead of a response. This maps to HTTP status 429 and the standard RPC error format:

```json
{
  "id": "request-id",
  "error": {
    "code": -32001,
    "message": "Daily token budget exceeded: 50000 >= 50000"
  }
}
```

Budget limits are configured under `sessions.budgets` in `haya.config.yaml`:

```yaml
sessions:
  budgets:
    maxTokensPerSession: 100000
    maxTokensPerDay: 500000
    maxRequestsPerDay: 1000
```

All three limits are optional; omit any to leave that dimension uncapped.

### sessions.list

List all sessions.

**Params:** None

**Result:**

```json
{
  "sessions": [
    {
      "id": "abc123",
      "title": "My Session",
      "createdAt": 1708300000000,
      "updatedAt": 1708300000000
    }
  ]
}
```

### sessions.create

Create a new session.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Session title |
| `model` | string | No | AI model for this session |

**Result:**

```json
{
  "sessionId": "abc123"
}
```

### sessions.delete

Delete a session.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID to delete |

**Result:**

```json
{
  "deleted": true
}
```

### sessions.history

Get conversation history for a session.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID |
| `limit` | number | No | Max messages to return (from end) |

**Result:**

```json
{
  "sessionId": "abc123",
  "messages": [
    { "role": "user", "content": "Hello", "timestamp": 1708300000000 },
    { "role": "assistant", "content": "Hi!", "timestamp": 1708300001000 }
  ]
}
```

### channels.list

List all registered channels and their status.

**Params:** None

**Result:**

```json
{
  "channels": [
    {
      "id": "slack",
      "name": "Slack",
      "status": { "connected": true, "connectedSince": 1708300000000 }
    }
  ]
}
```

### channels.start

Start a specific channel.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channelId` | string | Yes | Channel ID to start |

**Result:**

```json
{ "ok": true }
```

### channels.stop

Stop a specific channel.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channelId` | string | Yes | Channel ID to stop |

**Result:**

```json
{ "ok": true }
```

### cron.list

List all cron jobs.

**Params:** None

**Result:**

```json
{
  "jobs": [
    {
      "id": "uuid",
      "name": "daily-summary",
      "schedule": "0 9 * * *",
      "action": "summarize",
      "enabled": true,
      "lastRunAt": 1708300000000
    }
  ]
}
```

### cron.status

Get cron service status including active timers.

**Params:** None

**Result:**

```json
{
  "running": true,
  "activeTimers": 3,
  "jobs": [ ... ]
}
```

### cron.add

Add a new cron job dynamically.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Job name |
| `schedule` | string | Yes | Cron expression (e.g., `0 9 * * *`) |
| `action` | string | Yes | Action to execute |
| `enabled` | boolean | No | Whether job is enabled (default: true) |

**Result:**

```json
{
  "job": {
    "id": "uuid",
    "name": "daily-summary",
    "schedule": "0 9 * * *",
    "action": "summarize",
    "enabled": true
  }
}
```

### cron.remove

Remove a cron job.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | string | Yes | Job ID to remove |

**Result:**

```json
{
  "removed": true
}
```

## Health endpoint

```
GET /health
```

Returns `200 OK` when the gateway is running. Used by Docker HEALTHCHECK.

## Web chat UI

The gateway serves a built-in web chat interface at:

```
http://localhost:18789/chat
```

Pass authentication via the `token` query parameter:

```
http://localhost:18789/chat?token=<your-token>
```

The web UI connects to the WebSocket endpoint using the provided token, creates a client-side session, and renders messages in real time using `chat.delta` streaming events. It requires no external assets -- all HTML, CSS, and JavaScript are served inline from a single endpoint. The UI features auto-reconnect with exponential backoff and a connection status indicator.
