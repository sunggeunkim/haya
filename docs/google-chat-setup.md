# Google Chat Integration Setup

Guide for connecting Haya to Google Chat using an HTTP webhook endpoint.

## Overview

The Google Chat integration uses Google's outgoing webhook (HTTP endpoint) model, which means:
- A public URL is required for Google Chat to deliver events
- Bearer token verification secures the endpoint
- Supports text messages and threads within Google Chat spaces

## Prerequisites

- A Google Workspace account with admin access
- A Google Cloud project
- A public URL or tunnel (e.g., ngrok) for webhook delivery
- Haya installed and running

## Step 1: Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Chat API** under **APIs & Services** > **Library**

## Step 2: Configure the Chat app

1. In the Google Cloud Console, go to **APIs & Services** > **Google Chat API** > **Configuration**
2. Fill in the app details:
   - **App name**: e.g., "Haya Assistant"
   - **Avatar URL**: optional
   - **Description**: optional
3. Under **Connection settings**, select **HTTP endpoint URL**
4. Enter your public URL where Haya will be listening:
   ```
   https://your-domain.com
   ```
5. Under **Authentication Audience**, select **HTTP endpoint URL**
6. Under **Visibility**, choose who can install the app (specific people or your entire organization)
7. Click **Save**

## Step 3: Set up the verification token

1. Generate a secure random string to use as a verification token
2. In the Google Chat API configuration, set this token as the **Verification Token** (under the HTTP endpoint settings)
3. This is your `GOOGLE_CHAT_VERIFY_TOKEN`

## Step 4: Configure Haya

Add the verification token to your `.env` file:

```bash
GOOGLE_CHAT_VERIFY_TOKEN=your-verification-token
```

If you need outbound messaging (replies sent via the Google Chat REST API), also set:

```bash
GOOGLE_CHAT_SERVICE_ACCOUNT_TOKEN=your-service-account-bearer-token
```

## Step 5: Start Haya

```bash
pnpm dev start
```

The Google Chat channel will start an HTTP server on port 8443 (default) and begin listening for events.

## How it works

### Bearer token verification

Every incoming POST request is verified by checking the `Authorization` header:
- The header must be in the format `Bearer <token>`
- The token must match your configured `GOOGLE_CHAT_VERIFY_TOKEN`
- Requests without a valid token receive HTTP 401

### Event handling

The plugin processes Google Chat events:
- Only `MESSAGE` events with text content are processed
- Other event types (e.g., `ADDED_TO_SPACE`, `CARD_CLICKED`) are acknowledged with HTTP 200 but not processed

### Session routing

Messages are routed to sessions based on the Google Chat space:
- **All messages**: Session key is `google-chat:space:<space-id>`

The space ID is extracted from the space name (e.g., `spaces/AAAA_BBB` becomes `AAAA_BBB`). All messages within a space share the same session.

### Thread support

Google Chat thread names are passed as `threadId`. Outbound replies include the thread name and use `REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD` to maintain thread context.

### Outbound messages

Replies are sent via the Google Chat REST API (`chat.googleapis.com/v1/{space}/messages`). The `GOOGLE_CHAT_SERVICE_ACCOUNT_TOKEN` environment variable is used for authentication.

### Prompt injection protection

All inbound Google Chat messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

The Google Chat channel resolves its configuration from environment variables and settings. You can customize these in the config file:

```json
{
  "channels": {
    "google-chat": {
      "webhookPort": 8443,
      "verifyTokenEnvVar": "GOOGLE_CHAT_VERIFY_TOKEN"
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `webhookPort` | `8443` | Port for the webhook HTTP server |
| `verifyTokenEnvVar` | `GOOGLE_CHAT_VERIFY_TOKEN` | Env var name for the Bearer verification token |

## Troubleshooting

### "Required environment variable not set"

Make sure `GOOGLE_CHAT_VERIFY_TOKEN` is set in your `.env` file.

### HTTP 401 "Unauthorized"

1. Verify the token in your `.env` matches the verification token configured in the Google Chat API settings
2. Check that Google Chat is sending the `Authorization: Bearer <token>` header

### Bot not responding

1. Ensure the HTTP endpoint URL in the Google Chat API configuration points to your public URL on the correct port
2. Verify the app is published and installed in the target space
3. Check Haya logs for incoming event details

### Outbound messages failing

1. Verify `GOOGLE_CHAT_SERVICE_ACCOUNT_TOKEN` is set and valid
2. The service account must have the `chat.bot` scope
3. Check that the space name format is correct (e.g., `spaces/AAAA_BBB`)
