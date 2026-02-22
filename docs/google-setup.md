# Google Services Setup

Haya integrates with several Google services. Google Calendar, Gmail, and Drive share a single OAuth2 credential. Google Custom Search uses a separate API key.

---

## Google Custom Search

The `web_search` tool can use Google Custom Search Engine (CSE) as its provider instead of Brave Search.

### 1. Create a Custom Search Engine

1. Go to [Programmable Search Engine](https://programmablesearchengine.google.com/)
2. Click **Add** to create a new search engine
3. Under "What to search", select **Search the entire web**
4. Copy the **Search engine ID** (the `cx` value)

### 2. Get an API key

1. Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials > API key**
3. (Recommended) Restrict the key to **Custom Search API** only

### 3. Configure environment variables

Add to your `.env` file:

```bash
GOOGLE_CSE_API_KEY=your-api-key
GOOGLE_CSE_SEARCH_ENGINE_ID=your-search-engine-id
```

### 4. Enable in haya.json

```json5
{
  "tools": {
    "webSearch": {
      "provider": "google",
      "apiKeyEnvVar": "GOOGLE_CSE_API_KEY",
      "searchEngineId": "your-search-engine-id"
    }
  }
}
```

Note: `searchEngineId` is the literal value, not an env var reference. The API key is resolved from the environment at runtime via `apiKeyEnvVar`.

### Limits

Google CSE free tier allows 100 queries/day. Results are capped at 10 per request (Google API limit).

---

## Google Calendar, Gmail & Drive

Google Calendar, Gmail, and Google Drive share a single OAuth2 credential.

## 1. Create Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services > Library** and enable:
   - Google Calendar API
   - Gmail API
   - Google Drive API
4. Navigate to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth client ID**
6. Application type: **Desktop app**
7. Copy the **Client ID** and **Client Secret**

## 2. Configure environment variables

Add to your `.env` file:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

Optional: if you already have a refresh token (e.g., from another tool), you can skip the browser consent flow:

```bash
GOOGLE_REFRESH_TOKEN=your-refresh-token
```

## 3. Enable services in haya.json

Add a `tools.google` section to your config file:

```json5
{
  // ... existing config ...
  "tools": {
    "google": {
      "clientIdEnvVar": "GOOGLE_CLIENT_ID",
      "clientSecretEnvVar": "GOOGLE_CLIENT_SECRET",
      // Optional: pre-configured refresh token env var
      // "refreshTokenEnvVar": "GOOGLE_REFRESH_TOKEN",
      "calendar": { "enabled": true },
      "gmail": { "enabled": true },
      "drive": { "enabled": true }
    }
  }
}
```

Only enable the services you need. Each service registers its own set of tools.

## 4. Authorize with Google

Run the interactive OAuth consent flow:

```bash
pnpm dev google auth
```

This will:
1. Start a temporary local HTTP server
2. Open your browser to the Google consent page
3. After you approve, exchange the authorization code for tokens
4. Save tokens to `data/google-tokens.json` (with `0o600` permissions)

If the browser doesn't open automatically, copy the printed URL manually.

To revoke stored tokens:

```bash
pnpm dev google revoke
```

## Available tools

### Google Calendar (7 tools)

| Tool | Policy | Description |
|------|--------|-------------|
| `calendar_list_events` | allow | List upcoming events from a calendar |
| `calendar_search_events` | allow | Search events by keyword |
| `calendar_list_calendars` | allow | List all calendars |
| `calendar_get_freebusy` | allow | Check free/busy status for a time range |
| `calendar_create_event` | confirm | Create a new calendar event |
| `calendar_update_event` | confirm | Update an existing event (PATCH) |
| `calendar_delete_event` | confirm | Delete a calendar event |

### Gmail (6 tools)

| Tool | Policy | Description |
|------|--------|-------------|
| `gmail_search` | allow | Search emails using Gmail query syntax |
| `gmail_read_email` | allow | Read a specific email by message ID |
| `gmail_get_thread` | allow | Read an entire email thread |
| `gmail_list_labels` | allow | List all Gmail labels |
| `gmail_create_draft` | confirm | Create a draft email |
| `gmail_send_draft` | confirm | Send an existing draft |

Gmail uses a **draft-first** pattern for safety: the agent creates a draft, which requires user confirmation before sending.

Email content is wrapped with prompt injection protection boundaries (`wrapExternalContent()`).

### Google Drive (5 tools)

| Tool | Policy | Description |
|------|--------|-------------|
| `drive_search` | allow | Search files by name or content |
| `drive_read_file` | allow | Read file contents (auto-exports Google Docs to markdown, Sheets to CSV) |
| `drive_list_folder` | allow | List files in a folder |
| `drive_create_file` | confirm | Create/upload a new file |
| `drive_share_file` | confirm | Share a file with another user |

## Tool policies

- **allow**: Tool runs without user confirmation (read-only operations)
- **confirm**: Tool requires user approval before execution (write operations)

These policies are enforced by the `ToolPolicyEngine`. You can override them in `haya.json` under `agent.toolPolicies`.

## Troubleshooting

### "Google OAuth not authorized"
Run `pnpm dev google auth` to complete the consent flow, or set `GOOGLE_REFRESH_TOKEN` in `.env`.

### "Token refresh failed"
Your refresh token may have been revoked. Run `pnpm dev google revoke` then `pnpm dev google auth` to re-authorize.

### Scopes
Haya requests only the scopes needed for enabled services:
- Calendar: `https://www.googleapis.com/auth/calendar.events`
- Gmail: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.compose`
- Drive: `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.file`
