# IRC Integration Setup

Guide for connecting Haya to IRC using raw TCP/TLS sockets.

## Overview

The IRC integration connects directly to an IRC server via TCP or TLS, which means:
- No external libraries or API tokens required
- Supports TLS encryption by default (port 6697)
- Responds to nick mentions in channels and direct messages
- Automatic reconnection on disconnect

## Prerequisites

- An IRC server to connect to
- Haya installed and running

## Step 1: Choose an IRC server

Common public IRC networks:
- **Libera.Chat**: `irc.libera.chat` (port 6697 for TLS)
- **OFTC**: `irc.oftc.net` (port 6697 for TLS)
- **Self-hosted**: any IRCd (e.g., InspIRCd, UnrealIRCd)

## Step 2: Configure Haya

Add IRC settings to your Haya config file:

```json
{
  "channels": {
    "irc": {
      "server": "irc.libera.chat",
      "port": 6697,
      "tls": true,
      "nick": "haya-bot",
      "channels": ["#your-channel"]
    }
  }
}
```

### Optional: Server password (NickServ/SASL)

If your IRC server or nickname requires authentication, set a password via environment variable:

1. Add the password env var name to your config:

   ```json
   {
     "channels": {
       "irc": {
         "server": "irc.libera.chat",
         "port": 6697,
         "tls": true,
         "nick": "haya-bot",
         "channels": ["#your-channel"],
         "passwordEnvVar": "IRC_PASSWORD"
       }
     }
   }
   ```

2. Set the password in your `.env` file:

   ```bash
   IRC_PASSWORD=your-server-or-nickserv-password
   ```

   The password is sent as a `PASS` command during connection, which is compatible with most IRC authentication methods.

## Step 3: Start Haya

```bash
pnpm dev start
```

The IRC channel will connect to the server, register with the configured nick, and join the specified channels.

## How it works

### Connection and registration

On startup, the plugin:
1. Opens a TLS (or plain TCP) connection to the IRC server
2. Sends `PASS` if a password env var is configured
3. Sends `NICK` and `USER` commands to register
4. After receiving the RPL_WELCOME (001) response, joins all configured channels

### Nick mention detection

In channels, the bot only responds to messages that start with its nick:
- `haya-bot: what time is it?` -- triggers a response
- `haya-bot, help me` -- triggers a response
- `haya-bot something` -- triggers a response
- `hey everyone` -- ignored

The nick prefix is stripped before the message is passed to the AI.

In private messages (DMs), all messages are processed regardless of nick mention.

### Session routing

Messages are routed to sessions based on context:
- **Channel messages**: Session key is `irc:channel:<channel-name>` (e.g., `irc:channel:#general`)
- **Private messages**: Session key is `irc:dm:<nick>` (e.g., `irc:dm:someuser`)

Each channel and each DM conversation gets its own session with isolated history.

### Message splitting

IRC has a 512-byte message limit (including protocol overhead). The plugin automatically splits long messages into multiple `PRIVMSG` lines at a conservative 400-character limit.

### Automatic reconnection

If the connection drops, the plugin automatically reconnects after 5 seconds. This continues as long as the channel is active. A graceful `QUIT` command is sent on shutdown.

### Prompt injection protection

All inbound IRC messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `server` | `localhost` | IRC server hostname |
| `port` | `6697` (TLS) / `6667` (plain) | IRC server port |
| `tls` | `true` | Whether to use TLS encryption |
| `nick` | `haya-bot` | Bot nickname |
| `channels` | `[]` | Channels to join (e.g., `["#general", "#random"]`) |
| `passwordEnvVar` | (none) | Env var name for the server password (optional) |

## Troubleshooting

### Bot does not connect

1. Verify the server hostname and port are correct
2. If using TLS (default), ensure the server supports TLS on the configured port
3. To use a plain TCP connection, set `"tls": false` and `"port": 6667`
4. Check Haya logs for socket errors

### Bot connects but does not join channels

1. Ensure the `channels` array is not empty
2. Channel names must start with `#` (e.g., `"#general"`, not `"general"`)
3. Some channels may require an invitation or be restricted

### Bot does not respond in channels

1. Messages must start with the bot's nick followed by `:`, `,`, or a space
2. Verify the configured nick matches what appears in the IRC channel
3. Check Haya logs for incoming message processing

### "Nick already in use"

Another user or bot is using the configured nick. Change the `nick` setting to a unique name.

### Connection drops frequently

1. The plugin handles PING/PONG keepalive automatically
2. Check for network issues between your server and the IRC server
3. The plugin will automatically reconnect after 5 seconds
