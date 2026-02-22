# CLI Reference

Haya provides a command-line interface for managing your personal AI assistant gateway. All commands are accessed through the `haya` binary.

```
haya <command> [options]
```

Global options:

| Flag | Description |
|------|-------------|
| `-V, --version` | Print the version number. |
| `-h, --help` | Display help for a command. |

---

## haya init

Create a new `haya.json` config file with a generated authentication token.

```
haya init [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | `haya.json` | Path to the config file to create. |
| `--provider-key-env <var>` | `OPENAI_API_KEY` | Name of the environment variable for the AI provider API key. |

This command will:
1. Generate a random 64-character hex token for gateway authentication.
2. Write a minimal config file with `0600` permissions.
3. Print the generated token so you can add it to your `.env` file.

The command refuses to overwrite an existing config file.

**Example:**

```bash
# Create config with defaults
haya init

# Create config at a custom path using Anthropic
haya init --config my-config.json --provider-key-env ANTHROPIC_API_KEY
```

**Sample output:**

```
Created haya.json (permissions: 0600)

Add this to your .env file:
  ASSISTANT_GATEWAY_TOKEN=<generated-token>

Then start the gateway:
  pnpm dev start
```

---

## haya start

Start the gateway server. This is the main command that boots the full Haya runtime including the HTTP gateway, AI agent, channel integrations, cron scheduler, and all configured tools.

```
haya start [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | `haya.json` | Path to the config file. |
| `-p, --port <number>` | *(from config)* | Override the gateway port defined in the config file. |

At startup, Haya will:
- Load and validate the config file.
- Auto-detect channels from environment variables (`SLACK_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`).
- Initialize the AI provider (or fallback chain if `agent.providers` is configured).
- Register built-in tools and any tool integrations (Google Maps, Calendar, Gmail, Drive).
- Initialize sender authentication (if configured).
- Start the cron scheduler.
- Start all channel connections.
- Begin listening for HTTP requests.

**Example:**

```bash
# Start with default config
haya start

# Start with custom config and port override
haya start --config production.json --port 8080
```

---

## haya channels list

List all registered channels and their connection status.

```
haya channels list [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | `haya.json` | Path to the config file. |

**Example:**

```bash
haya channels list
```

**Sample output:**

```
  slack (Slack): connected
  discord (Discord): disconnected
```

---

## haya channels start

Start a specific channel by its ID. This command requires a running gateway and will direct you to use the gateway API.

```
haya channels start <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | The channel ID to start. |

**Example:**

```bash
haya channels start slack
```

---

## haya channels stop

Stop a specific channel by its ID. This command requires a running gateway and will direct you to use the gateway API.

```
haya channels stop <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | The channel ID to stop. |

**Example:**

```bash
haya channels stop discord
```

---

## haya cron list

List all configured cron jobs, their status, and last run time.

```
haya cron list [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | `haya.json` | Path to the config file. |

**Example:**

```bash
haya cron list
```

**Sample output:**

```
  nightly-prune [enabled] -- 0 3 * * * -- last run: 2026-02-21T03:00:00.000Z
  weekly-report [disabled] -- 0 9 * * 1 -- last run: never
```

---

## haya cron add

Add a new cron job.

```
haya cron add [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | *(required)* | Human-readable name for the job. |
| `-s, --schedule <cron>` | *(required)* | Cron expression (e.g., `"0 3 * * *"`). |
| `-a, --action <action>` | *(required)* | Action to execute (e.g., `"prune_sessions"`). |
| `--disabled` | *(not set)* | Create the job in a disabled state. |
| `-c, --config <path>` | `haya.json` | Path to the config file. |

**Example:**

```bash
# Add an enabled nightly session pruning job
haya cron add --name "nightly-prune" --schedule "0 3 * * *" --action "prune_sessions"

# Add a disabled job
haya cron add --name "weekly-report" --schedule "0 9 * * 1" --action "send_report" --disabled
```

**Sample output:**

```
Added job "nightly-prune" (abc123)
```

---

## haya cron remove

Remove a cron job by its ID.

```
haya cron remove <id> [options]
```

| Argument | Description |
|----------|-------------|
| `<id>` | The job ID to remove (shown in `cron list` output). |

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | `haya.json` | Path to the config file. |

**Example:**

```bash
haya cron remove abc123
```

---

## haya senders approve

Approve a sender using their pairing code. This is used when `senderAuth.mode` is set to `"pairing"`. When an unapproved sender messages the assistant, they receive a pairing code. An administrator then runs this command to authorize them.

```
haya senders approve <code> [options]
```

| Argument | Description |
|----------|-------------|
| `<code>` | The pairing code provided to the sender. |

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --data-dir <path>` | `data/senders` | Directory where sender authorization data is stored. |

**Example:**

```bash
haya senders approve A1B2C3
```

**Sample output:**

```
Approved sender: user@example.com
```

---

## haya senders list

List all authorized senders and their status.

```
haya senders list [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --data-dir <path>` | `data/senders` | Directory where sender authorization data is stored. |

**Example:**

```bash
haya senders list
```

**Sample output:**

```
  user@example.com: allowed
  another-user: pending
```

---

## haya config show

Display the current configuration with sensitive values redacted.

```
haya config show [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | `haya.json` | Path to the config file. |

The output is formatted as indented JSON with secrets replaced by redacted placeholders.

**Example:**

```bash
haya config show
haya config show --config production.json
```

---

## haya audit

Run security audit checks against the project codebase. Exits with code 1 if any issues are found.

```
haya audit [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-r, --root <path>` | *(current directory)* | Root directory of the project to audit. |

**Example:**

```bash
haya audit
haya audit --root /home/user/my-haya-project
```

---

## haya doctor

Run diagnostic checks on the Haya installation. Verifies that the config is valid, required environment variables are set, dependencies are available, and services are reachable. Exits with code 1 if any checks fail.

```
haya doctor [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | *(optional)* | Path to the config file. If not provided, defaults are used. |

**Example:**

```bash
haya doctor
haya doctor --config production.json
```

---

## haya onboard

Launch the interactive setup wizard for a new Haya installation. This guides you through initial configuration step by step, including choosing a provider, setting up authentication, and creating the config file.

```
haya onboard
```

This command takes no options. It runs an interactive terminal prompt.

**Example:**

```bash
haya onboard
```

---

## haya usage

Show token usage statistics across sessions and models.

```
haya usage [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --session <id>` | *(optional)* | Filter usage to a specific session ID. |
| `--since <date>` | *(optional)* | Show usage since a given date (ISO 8601 format, e.g., `"2026-02-01"`). |

When `--session` is provided, the output shows token count and request count for that session. When omitted, a summary across all sessions is displayed, broken down by model.

**Example:**

```bash
# Show total usage
haya usage

# Show usage for a specific session
haya usage --session slack-general

# Show usage since the start of the month
haya usage --since 2026-02-01
```

**Sample output (all sessions):**

```
Usage summary:
  Total tokens: 1250000
  Prompt tokens: 800000
  Completion tokens: 450000
  Requests: 342

By model:
  gpt-4o: 1000000 tokens (280 requests)
  gpt-4o-mini: 250000 tokens (62 requests)
```

**Sample output (single session):**

```
Session: slack-general
  Total tokens: 45200
  Requests: 12
```

---

## haya google auth

Authorize Haya to access your Google services (Calendar, Gmail, Drive). Requires `tools.google` to be configured in your config file with at least one service enabled.

```
haya google auth [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | `haya.json` | Path to the config file. Falls back to `haya.json` then `haya.json5`. |

This command initiates the OAuth 2.0 authorization flow. It will print the scopes being requested and open/prompt for browser-based authorization. On success, tokens are saved to the path specified by `tools.google.tokenPath`.

**Example:**

```bash
haya google auth
haya google auth --config production.json
```

**Sample output:**

```
Starting Google OAuth authorization...
Scopes: https://www.googleapis.com/auth/calendar.events, https://www.googleapis.com/auth/gmail.readonly, https://www.googleapis.com/auth/gmail.compose

Authorization successful! Tokens saved.
```

---

## haya google revoke

Revoke and delete stored Google OAuth tokens.

```
haya google revoke [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | `haya.json` | Path to the config file. Falls back to `haya.json` then `haya.json5`. |

**Example:**

```bash
haya google revoke
```

**Sample output:**

```
Google OAuth tokens revoked and deleted.
```
