# KakaoTalk Integration Setup

Guide for connecting Haya to KakaoTalk using Kakao i Open Builder's skill server.

## Overview

The KakaoTalk integration uses Kakao i Open Builder's webhook-based skill server model, which means:
- Kakao's servers POST messages to your Haya skill server endpoint
- AI responses are delivered asynchronously via one-time callback URLs
- Your server must be reachable from the internet (or via a tunnel)

## Prerequisites

- A Kakao account
- A [Kakao i Open Builder](https://i.kakao.com/) account (linked to your Kakao account)
- Haya installed and running
- A publicly accessible URL for your skill server (direct IP, domain, or tunnel like ngrok)

## Step 1: Create a Kakao Channel

1. Go to [Kakao for Business](https://business.kakao.com/) and log in
2. Navigate to **Kakao Channel** and create a new channel
3. Complete the channel profile (name, description, profile image)

## Step 2: Create an Open Builder chatbot

1. Go to [Kakao i Open Builder](https://i.kakao.com/) and log in
2. Click **Create chatbot**
3. Link the chatbot to the Kakao Channel you created in Step 1
4. Under **Scenario** > **Fallback Block** (the default block that handles all unmatched messages):
   - Click the Fallback Block to edit it
   - Add a **Skill** response
   - Set the skill URL to your Haya endpoint (see Step 3)
   - Enable **Callback** (this allows async responses for AI processing that takes >3 seconds)

## Step 3: Configure Haya

Set the `KAKAO_SKILL_PORT` environment variable in your `.env` file. This serves as both the enable flag and the port number:

```bash
KAKAO_SKILL_PORT=9091
```

Haya will start a skill server on this port at the path `/kakao/skill`.

Your full skill URL will be:

```
https://your-domain.com:9091/kakao/skill
```

If you are behind a reverse proxy (e.g., nginx), configure it to forward traffic to the local skill server port.

## Step 4: Start Haya

```bash
pnpm dev start
```

You should see in the logs:

```
KakaoTalk channel detected via KAKAO_SKILL_PORT
KakaoTalk skill server listening on port 9091 at /kakao/skill
```

## Step 5: Deploy and test

1. In Open Builder, click **Deploy** to publish your chatbot
2. Open KakaoTalk and search for your Kakao Channel name
3. Add the channel as a friend and send a message
4. You should receive a "잠시만 기다려주세요..." placeholder, followed by the AI response

## How it works

### Request flow

```
User → KakaoTalk → Kakao i Open Builder → POST /kakao/skill → Haya
Haya → immediate response: { useCallback: true }
Haya → AI processing → POST callbackUrl → Kakao → User
```

1. When a user sends a message, Kakao i Open Builder POSTs a skill payload to your endpoint
2. Haya immediately responds with `useCallback: true` and a placeholder message ("잠시만 기다려주세요...")
3. The AI processes the message asynchronously
4. Haya POSTs the AI response to the one-time `callbackUrl` provided in the original payload

### Callback mechanism

Kakao i Open Builder requires skill servers to respond within 5 seconds. Since AI responses typically take longer, Haya uses the callback mechanism:

- **Immediate response**: Haya returns `{ "version": "2.0", "useCallback": true }` within milliseconds
- **Async delivery**: The actual AI response is POSTed to the `callbackUrl` when ready
- **Expiry**: Callback URLs expire after 1 minute. Haya auto-purges stale entries at 55 seconds
- **One-time use**: Each callback URL can only be used once

If a message arrives without a `callbackUrl` (e.g., from an older API version), Haya responds synchronously with a simple acknowledgment.

### Message format

Responses are sent in Kakao's simpleText format:

```json
{
  "version": "2.0",
  "template": {
    "outputs": [{ "simpleText": { "text": "AI response here" } }]
  }
}
```

Kakao's simpleText has a 1000-character limit per output. Long AI responses are automatically chunked into up to 3 outputs. If the response still doesn't fit, the last chunk is truncated with an ellipsis.

### Session routing

Each KakaoTalk user gets their own session:
- **Session key**: `kakao:user:<botUserKey>`

The `botUserKey` is a unique, anonymous identifier assigned by Kakao to each user interacting with your chatbot. It is not the user's KakaoTalk ID.

### Prompt injection protection

All inbound KakaoTalk messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

The KakaoTalk channel resolves its configuration from the environment and optional channel settings in the config file:

```json
{
  "channels": {
    "kakao": {
      "port": 9091,
      "path": "/kakao/skill",
      "botName": "kakao-bot",
      "maxPayloadBytes": 1048576
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `9091` | Port for the skill server HTTP endpoint |
| `path` | `/kakao/skill` | URL path for the skill endpoint |
| `botName` | `"kakao-bot"` | Display name for this bot |
| `maxPayloadBytes` | `1048576` (1 MB) | Maximum request body size |

Note: The `KAKAO_SKILL_PORT` environment variable takes precedence over the `port` setting in the config file.

## Using with a reverse proxy

If Haya runs behind nginx or another reverse proxy, configure it to forward requests to the skill server port:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    location /kakao/skill {
        proxy_pass http://127.0.0.1:9091;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then set your skill URL in Open Builder to `https://your-domain.com/kakao/skill`.

## Using with ngrok (development)

For local development, you can use ngrok to expose your skill server:

```bash
ngrok http 9091
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`) and set your skill URL in Open Builder to:

```
https://abc123.ngrok-free.app/kakao/skill
```

Note: ngrok URLs change each time you restart ngrok (unless you have a paid plan with reserved domains).

## Troubleshooting

### "잠시만 기다려주세요..." but no AI response follows

1. Check Haya logs for errors in AI processing
2. Verify your AI provider API key is correctly set
3. Ensure the AI response completes within 1 minute (the callback URL expiry)
4. Check that Haya can make outbound HTTPS requests to Kakao's callback servers

### Bot not responding at all

1. Verify `KAKAO_SKILL_PORT` is set in your `.env` file
2. Check that the skill server is running (`KakaoTalk skill server listening on port ...` in logs)
3. Ensure your skill URL in Open Builder matches your actual endpoint
4. Test the endpoint directly:

```bash
curl -X POST http://localhost:9091/kakao/skill \
  -H "Content-Type: application/json" \
  -d '{
    "userRequest": {
      "utterance": "Hello",
      "user": { "id": "test-user-123" }
    }
  }'
```

You should get a response with `"메시지를 받았습니다."` (since there's no callbackUrl in this test).

### HTTP 400 "Missing userRequest.utterance or userRequest.user.id"

The incoming payload is missing required fields. Ensure your Open Builder skill block is configured correctly and sending the standard skill payload format.

### HTTP 413 "Payload too large"

The request body exceeds `maxPayloadBytes` (default: 1 MB). Increase the limit in your config if needed.

### Callback POST fails

1. Ensure Haya has outbound internet access
2. Check logs for `Callback POST failed: <status>` errors
3. Kakao's callback servers may be temporarily unavailable -- the message will be lost in this case

### Open Builder deployment issues

1. Make sure you clicked **Deploy** after configuring the skill block
2. Deployment can take a few minutes to propagate
3. Check the Open Builder dashboard for any deployment errors or warnings
