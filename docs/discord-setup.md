# Discord Integration Setup

Guide for connecting Haya to Discord using discord.js v14.

## Overview

The Discord integration uses the discord.js library with Gateway intents, which means:
- Connection initiated from your server to Discord via WebSocket
- No public URL or webhook endpoint required
- Works behind firewalls and NAT

## Prerequisites

- A Discord server where you have admin permissions
- Haya installed and running

## Step 1: Create a Discord application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it (e.g., "Haya Assistant") and click **Create**

## Step 2: Create a bot user

1. In the application settings, go to **Bot**
2. Click **Add Bot** and confirm
3. Under **Token**, click **Copy** -- this is your `DISCORD_BOT_TOKEN`
4. Keep this token secret; if compromised, click **Reset Token** to generate a new one

## Step 3: Enable required intents

1. Still on the **Bot** page, scroll to **Privileged Gateway Intents**
2. Enable the following intents:
   - **Message Content Intent** -- required to read message text
   - **Server Members Intent** -- optional, for member info
3. Click **Save Changes**

## Step 4: Set bot permissions and invite to server

1. Go to **OAuth2** > **URL Generator**
2. Under **Scopes**, select `bot`
3. Under **Bot Permissions**, select:
   - `Send Messages` -- reply to users
   - `Read Message History` -- read channel messages
   - `View Channels` -- see available channels
4. Copy the generated URL and open it in your browser
5. Select your server and click **Authorize**

## Step 5: Configure Haya

Add the bot token to your `.env` file:

```bash
DISCORD_BOT_TOKEN=your-discord-bot-token
```

## Step 6: Start Haya

```bash
pnpm dev start
```

The Discord channel will connect via the Gateway WebSocket and begin listening for messages.

## How it works

### Gateway intents

The plugin registers with the following Gateway intents:
- `Guilds` -- access guild (server) information
- `GuildMessages` -- receive messages in server channels
- `MessageContent` -- read the content of messages
- `DirectMessages` -- receive DM messages (uses the `Channel` partial)

### Session routing

Messages are routed to sessions based on context:
- **DMs**: Session key is `discord:dm:<user-id>`
- **Server channels**: Session key is `discord:channel:<channel-id>`

Each DM conversation and each server channel gets its own session with isolated history.

### Thread support

When a user replies to a message, the reply reference is passed as `threadId`. Outbound messages can reply to a specific message by providing a `threadId`.

### Prompt injection protection

All inbound Discord messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

The Discord channel resolves its configuration from environment variables. You can customize the env var name in the config file:

```json
{
  "channels": {
    "discord": {
      "botTokenEnvVar": "DISCORD_BOT_TOKEN"
    }
  }
}
```

## Troubleshooting

### "Required environment variable not set"

Make sure `DISCORD_BOT_TOKEN` is set in your `.env` file.

### Bot not responding

1. Check that the bot has been invited to the server with correct permissions
2. Verify that **Message Content Intent** is enabled in the Discord Developer Portal
3. Check Haya logs for connection errors

### Bot does not receive DMs

The plugin uses `Partials.Channel` to receive DMs. If DMs are not working, verify the bot is not restricted by Discord server privacy settings.

### "invalid token" error

The bot token may be expired or reset. Go to the Discord Developer Portal and copy a fresh token.
