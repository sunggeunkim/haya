# WhatsApp Integration Setup

Guide for connecting Haya to WhatsApp using the WhatsApp Cloud API.

## Overview

The WhatsApp integration uses Meta's Cloud API with an HTTP webhook receiver, which means:
- A public URL is required for Meta to deliver webhook events
- Outbound messages are sent via the WhatsApp Cloud API
- Supports text messages in private conversations

## Prerequisites

- A Meta Business account
- A Meta Developer account
- A WhatsApp Business phone number (Meta provides a free test number)
- A public URL or tunnel (e.g., ngrok) for webhook delivery
- Haya installed and running

## Step 1: Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com/)
2. Click **My Apps** > **Create App**
3. Select **Business** as the app type
4. Fill in the app name and contact email, then click **Create App**

## Step 2: Set up WhatsApp

1. In your app dashboard, click **Add Product** and select **WhatsApp**
2. Follow the prompts to connect a Meta Business account
3. Under **API Setup**, you will see:
   - A temporary **Access Token** -- this is your `WHATSAPP_ACCESS_TOKEN`
   - A **Phone Number ID** -- this is your `WHATSAPP_PHONE_NUMBER_ID`
4. For production, generate a permanent access token via **System Users** in Business Settings

## Step 3: Configure the webhook

1. In the WhatsApp product settings, go to **Configuration**
2. Under **Webhook**, click **Edit**
3. Set the **Callback URL** to your public URL followed by the webhook path:
   ```
   https://your-domain.com/webhook/whatsapp
   ```
4. Set the **Verify Token** to a secret string of your choice -- this is your `WHATSAPP_VERIFY_TOKEN`
5. Click **Verify and Save**
6. Subscribe to the `messages` webhook field

## Step 4: Configure Haya

Add the required values to your `.env` file:

```bash
WHATSAPP_ACCESS_TOKEN=your-access-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_VERIFY_TOKEN=your-chosen-verify-token
```

## Step 5: Start Haya

```bash
pnpm dev start
```

The WhatsApp channel will start an HTTP server on port 3100 (default) and begin listening for webhook events.

## How it works

### Webhook verification

When Meta sends a verification request (GET), the plugin checks:
- `hub.mode` is `subscribe`
- `hub.verify_token` matches your configured verify token
- Returns the `hub.challenge` value to complete verification

### Inbound messages

When a message arrives (POST), the plugin:
1. Responds with HTTP 200 immediately (required by WhatsApp)
2. Parses the Cloud API webhook payload
3. Extracts text messages from the `messages` array
4. Routes them through Haya's message pipeline

### Session routing

Messages are routed to sessions based on the sender's phone number:
- **All messages**: Session key is `whatsapp:dm:<phone-number>`

Each conversation with a distinct phone number gets its own session with isolated history.

### Outbound messages

Replies are sent via the WhatsApp Cloud API (`graph.facebook.com/v18.0/{phone-number-id}/messages`). The `WHATSAPP_ACCESS_TOKEN` is required for authentication.

### Prompt injection protection

All inbound WhatsApp messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

The WhatsApp channel resolves its configuration from environment variables and settings. You can customize these in the config file:

```json
{
  "channels": {
    "whatsapp": {
      "phoneNumberId": "your-phone-number-id",
      "accessTokenEnvVar": "WHATSAPP_ACCESS_TOKEN",
      "verifyToken": "your-verify-token",
      "webhookPath": "/webhook/whatsapp",
      "port": 3100
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `phoneNumberId` | (none) | WhatsApp Cloud API phone number ID |
| `accessTokenEnvVar` | `WHATSAPP_ACCESS_TOKEN` | Env var name for the access token |
| `verifyToken` | (none) | Token used for webhook verification |
| `webhookPath` | `/webhook/whatsapp` | URL path for the webhook endpoint |
| `port` | `3100` | Port for the webhook HTTP server |

## Troubleshooting

### "Required environment variable not set"

Make sure `WHATSAPP_ACCESS_TOKEN` is set in your `.env` file.

### Webhook verification fails

1. Confirm the **Verify Token** in the Meta dashboard matches the `verifyToken` in your Haya config or `.env`
2. Ensure the callback URL is publicly reachable
3. Check that Haya is running and listening on the correct port

### Messages not arriving

1. Verify you have subscribed to the `messages` webhook field in the Meta dashboard
2. Check that the phone number is correctly linked in the WhatsApp product settings
3. Look at Haya logs for webhook parsing errors

### "WhatsApp API error: HTTP 401"

The access token is invalid or expired. Generate a new token in the Meta Developer Portal.
