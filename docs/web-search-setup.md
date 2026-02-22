# Web Search Setup

The `web_search` tool lets the agent search the web for current information. Two providers are supported: **Brave Search** (default) and **Google Custom Search**.

## Brave Search

### 1. Get an API key

1. Go to [Brave Search API](https://brave.com/search/api/)
2. Sign up and create a new subscription (the free plan allows 2,000 queries/month)
3. Copy your **API key**

### 2. Configure environment variables

Add to your `.env` file:

```bash
BRAVE_API_KEY=your-brave-api-key
```

### 3. Enable in haya.json

```json5
{
  "tools": {
    "webSearch": {
      "provider": "brave",
      "apiKeyEnvVar": "BRAVE_API_KEY"
    }
  }
}
```

### Limits

Brave Search free tier allows 2,000 queries/month. Up to 20 results per request.

---

## Google Custom Search

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

## Tool details

| Tool | Policy | Description |
|------|--------|-------------|
| `web_search` | allow | Search the web for current information |

**Parameters:**
- `query` (string, required) — the search query
- `count` (number, optional) — number of results to return (default: 5, max: 20 for Brave, 10 for Google)

The tool policy can be overridden in `haya.json` under `agent.toolPolicies`.
