# Signal Integration Setup

Guide for connecting Haya to Signal using the signal-cli JSON-RPC daemon.

## Overview

The Signal integration uses signal-cli's JSON-RPC interface, which means:
- Requires a running signal-cli daemon as a backend
- Haya polls the daemon for incoming messages every 2 seconds
- Supports both direct messages and group chats
- No public URL or webhook endpoint required

## Prerequisites

- A phone number registered with Signal
- [signal-cli](https://github.com/AsamK/signal-cli) installed and registered with your phone number
- signal-cli running in JSON-RPC daemon mode
- Haya installed and running

## Step 1: Install signal-cli

Follow the [signal-cli installation guide](https://github.com/AsamK/signal-cli#installation) for your platform.

Common methods:
- **Linux**: Download the release tarball from GitHub
- **Docker**: Use the official Docker image
- **macOS**: `brew install signal-cli`

## Step 2: Register your phone number

Register signal-cli with your Signal phone number:

```bash
signal-cli -u +1234567890 register
```

Complete verification with the code sent via SMS:

```bash
signal-cli -u +1234567890 verify 123-456
```

If you already use Signal on your phone, you can link signal-cli as a secondary device instead:

```bash
signal-cli link -n "Haya Bot"
```

## Step 3: Start the signal-cli daemon

Start signal-cli in JSON-RPC daemon mode:

```bash
signal-cli -u +1234567890 daemon --http localhost:7583
```

This starts an HTTP server on port 7583 that exposes the JSON-RPC interface. Verify it is running:

```bash
curl -X POST http://localhost:7583 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"version","id":1}'
```

## Step 4: Configure Haya

Add the phone number to your `.env` file:

```bash
SIGNAL_PHONE_NUMBER=+1234567890
```

## Step 5: Start Haya

```bash
pnpm dev start
```

The Signal channel will connect to the signal-cli daemon and begin polling for messages.

## How it works

### Message polling

The plugin polls the signal-cli daemon every 2 seconds by calling the `receive` JSON-RPC method. Each poll returns any pending message envelopes, which are then processed and routed through Haya's message pipeline.

### Session routing

Messages are routed to sessions based on context:
- **Direct messages**: Session key is `signal:dm:<phone-number>`
- **Group messages**: Session key is `signal:group:<group-id>`

Each direct conversation and each group gets its own session with isolated history.

### Outbound messages

Replies are sent via the signal-cli `send` JSON-RPC method. The plugin distinguishes between group and direct messages based on the channel ID length (group IDs are base64-encoded and longer than phone numbers).

### Prompt injection protection

All inbound Signal messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

The Signal channel resolves its configuration from environment variables and settings. You can customize these in the config file:

```json
{
  "channels": {
    "signal": {
      "jsonRpcUrl": "http://localhost:7583",
      "registeredNumberEnvVar": "SIGNAL_PHONE_NUMBER"
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `jsonRpcUrl` | `http://localhost:7583` | URL for the signal-cli JSON-RPC daemon |
| `registeredNumberEnvVar` | `SIGNAL_PHONE_NUMBER` | Env var name for the registered phone number |

## Troubleshooting

### "Required environment variable not set"

Make sure `SIGNAL_PHONE_NUMBER` is set in your `.env` file.

### "Failed to connect to signal-cli daemon"

1. Verify signal-cli is running in daemon mode with `--http`
2. Check that the JSON-RPC URL matches (default: `http://localhost:7583`)
3. Test the connection with a manual `curl` request to the version endpoint

### Messages not arriving

1. Ensure signal-cli is registered and verified with the correct phone number
2. Check that the daemon is running and not being consumed by another client
3. Look at Haya logs for poll errors

### Group messages not working

1. Verify the phone number is a member of the Signal group
2. Group IDs are base64-encoded; check Haya logs for the group ID format
