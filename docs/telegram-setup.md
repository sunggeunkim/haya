# Telegram Integration Setup

Guide for connecting Haya to Telegram using the grammy library.

## Overview

The Telegram integration uses long polling via the grammy Bot framework, which means:
- No public URL or webhook endpoint required
- Connection initiated from your server to the Telegram Bot API
- Works behind firewalls and NAT

## Prerequisites

- A Telegram account
- Haya installed and running

## Step 1: Create a bot with BotFather

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Follow the prompts to choose a name and username for your bot
4. BotFather will reply with a bot token -- this is your `TELEGRAM_BOT_TOKEN`

## Step 2: Configure bot settings (optional)

While still talking to BotFather, you can:
- `/setdescription` -- set the bot description shown in the profile
- `/setabouttext` -- set the "About" text
- `/setprivacy` -- set to **Disable** if you want the bot to see all messages in groups (by default it only sees commands)

## Step 3: Configure Haya

Add the bot token to your `.env` file:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
```

## Step 4: Start Haya

```bash
pnpm dev start
```

The Telegram channel will connect via long polling and begin listening for messages.

## How it works

### Long polling

The bot uses grammy's built-in long polling to fetch updates from the Telegram Bot API. This does not require a public URL or TLS certificate.

### Session routing

Messages are routed to sessions based on chat type:
- **Private chats (DMs)**: Session key is `telegram:dm:<user-id>`
- **Groups / Supergroups**: Session key is `telegram:group:<chat-id>`

Each private conversation and each group gets its own session with isolated history.

### Thread support

When a user replies to a message, the original message ID is passed as `threadId`. Outbound replies use `reply_to_message_id` to maintain the thread context.

### Prompt injection protection

All inbound Telegram messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

The Telegram channel resolves its configuration from environment variables. You can customize the env var name in the config file:

```json
{
  "channels": {
    "telegram": {
      "botTokenEnvVar": "TELEGRAM_BOT_TOKEN"
    }
  }
}
```

## Troubleshooting

### "Required environment variable not set"

Make sure `TELEGRAM_BOT_TOKEN` is set in your `.env` file.

### Bot not responding in groups

1. Check that the bot has been added to the group
2. If using privacy mode (default), the bot only sees messages that start with `/` commands. Disable privacy mode via BotFather (`/setprivacy` > **Disable**) to let the bot see all messages

### Bot not responding to DMs

1. Users must first send `/start` to initiate a conversation with the bot
2. Check Haya logs for connection errors

### "409 Conflict: terminated by other getUpdates request"

This means another instance of the bot is running and consuming updates. Stop the other instance before starting Haya.
