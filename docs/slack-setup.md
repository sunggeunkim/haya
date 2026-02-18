# Slack Integration Setup

Guide for connecting Haya to Slack using Socket Mode.

## Overview

The Slack integration uses `@slack/bolt` with Socket Mode, which means:
- No public URL or webhook endpoint required
- Connection initiated from your server to Slack
- Works behind firewalls and NAT

## Prerequisites

- A Slack workspace where you have admin permissions
- Haya installed and running

## Step 1: Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name it (e.g., "Haya Assistant") and select your workspace
4. Click **Create App**

## Step 2: Enable Socket Mode

1. In the app settings, go to **Socket Mode**
2. Toggle **Enable Socket Mode** on
3. Create an app-level token with the `connections:write` scope
4. Save the token -- this is your `SLACK_APP_TOKEN` (starts with `xapp-`)

## Step 3: Configure bot permissions

1. Go to **OAuth & Permissions**
2. Under **Bot Token Scopes**, add:
   - `chat:write` -- Send messages
   - `channels:history` -- Read channel messages
   - `groups:history` -- Read private channel messages
   - `im:history` -- Read DM messages
   - `mpim:history` -- Read group DM messages
   - `channels:read` -- View channel info
   - `groups:read` -- View private channel info
   - `im:read` -- View DM info
   - `users:read` -- View user info

## Step 4: Enable event subscriptions

1. Go to **Event Subscriptions**
2. Toggle **Enable Events** on
3. Under **Subscribe to bot events**, add:
   - `message.channels` -- Messages in public channels
   - `message.groups` -- Messages in private channels
   - `message.im` -- Direct messages
   - `message.mpim` -- Group direct messages

## Step 5: Install the app

1. Go to **Install App**
2. Click **Install to Workspace**
3. Authorize the app
4. Copy the **Bot User OAuth Token** -- this is your `SLACK_BOT_TOKEN` (starts with `xoxb-`)

## Step 6: Get the signing secret

1. Go to **Basic Information**
2. Under **App Credentials**, copy the **Signing Secret**
3. This is your `SLACK_SIGNING_SECRET`

## Step 7: Configure Haya

Add the tokens to your `.env` file:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
```

## Step 8: Start Haya

```bash
pnpm dev start
```

The Slack channel will connect via Socket Mode and begin listening for messages.

## How it works

### Session routing

Messages are routed to sessions based on context:
- **DMs**: Session key is `slack:dm:<user-id>`
- **Channels/threads**: Session key is `slack:channel:<channel-id>:<thread-ts>`

This means each DM conversation and each channel thread gets its own session with isolated history.

### Prompt injection protection

All inbound Slack messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

The Slack channel resolves its configuration from environment variables. You can customize the env var names in the config file:

```json
{
  "channels": {
    "slack": {
      "botTokenEnvVar": "SLACK_BOT_TOKEN",
      "appTokenEnvVar": "SLACK_APP_TOKEN",
      "signingSecretEnvVar": "SLACK_SIGNING_SECRET"
    }
  }
}
```

## Troubleshooting

### "Required environment variable not set"

Make sure all three Slack environment variables are set in your `.env` file.

### Bot not responding

1. Check that the bot is invited to the channel (`/invite @haya`)
2. Verify Socket Mode is enabled in the Slack app settings
3. Check Haya logs for connection errors

### "invalid_auth" error

The bot token may be expired or revoked. Reinstall the app in Slack to get a new token.
