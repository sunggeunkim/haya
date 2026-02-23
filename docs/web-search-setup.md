# Web Search Setup

The `web_search` tool lets the agent search the web for current information. Three providers are supported: **Tavily** (recommended), **Brave Search**, and **Google Custom Search**.

## Tavily (Recommended)

### 1. Get an API key

1. Go to [Tavily](https://tavily.com/)
2. Sign up for a free account (no credit card required)
3. Copy your **API key** from the dashboard

### 2. Configure environment variables

Add to your `.env` file:

```bash
TAVILY_API_KEY=tvly-your-api-key
```

### 3. Enable in haya.json

```json5
{
  "tools": {
    "webSearch": [
      { "provider": "tavily", "apiKeyEnvVar": "TAVILY_API_KEY" }
    ]
  }
}
```

### Limits

Free tier: 1,000 API credits/month (1 credit per basic search). Credits do not roll over. Paid plans available at $0.008 per credit.

---

## Brave Search

### 1. Get an API key

1. Go to [Brave Search API](https://brave.com/search/api/)
2. Sign up and create a new subscription
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
    "webSearch": [
      { "provider": "brave", "apiKeyEnvVar": "BRAVE_API_KEY" }
    ]
  }
}
```

### Limits

Brave Search API costs $5 per 1,000 requests. New accounts receive $5/month in free credits (with attribution). Up to 20 results per request.

---

## Google Custom Search

### 1. Create a Custom Search Engine

1. Go to [Programmable Search Engine](https://programmablesearchengine.google.com/)
2. Click **Add** to create a new search engine
3. Add sites to search (note: "Search the entire web" is no longer available for new engines)
4. Copy the **Search engine ID** (the `cx` value)

### 2. Get an API key

1. Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials > API key**
3. (Recommended) Restrict the key to **Custom Search API** only

### 3. Configure environment variables

Add to your `.env` file:

```bash
GOOGLE_CSE_API_KEY=your-api-key
```

### 4. Enable in haya.json

```json5
{
  "tools": {
    "webSearch": [
      {
        "provider": "google",
        "apiKeyEnvVar": "GOOGLE_CSE_API_KEY",
        "searchEngineId": "your-search-engine-id"
      }
    ]
  }
}
```

Note: `searchEngineId` is the literal value, not an env var reference. The API key is resolved from the environment at runtime via `apiKeyEnvVar`.

### Limits

Google CSE free tier allows 100 queries/day. Results are capped at 10 per request (Google API limit). New engines can only search specified domains (up to 50).

---

## Fallback Chain

You can configure multiple providers so that if the primary fails (error, rate limit), the tool automatically falls back to the next one. Providers are tried in order.

```json5
{
  "tools": {
    "webSearch": [
      { "provider": "tavily", "apiKeyEnvVar": "TAVILY_API_KEY" },
      { "provider": "brave", "apiKeyEnvVar": "BRAVE_API_KEY" }
    ]
  }
}
```

In this example, Tavily is tried first. If it fails for any reason (HTTP error, rate limit, network timeout), the tool retries with Brave Search. The last error is thrown only if all providers fail.

---

## Tool details

| Tool | Policy | Description |
|------|--------|-------------|
| `web_search` | allow | Search the web for current information |

**Parameters:**
- `query` (string, required) — the search query
- `count` (number, optional) — number of results to return (default: 5, max: 20 for Brave/Tavily, 10 for Google)

The tool policy can be overridden in `haya.json` under `agent.toolPolicies`.
