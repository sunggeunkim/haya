# Microsoft Teams Integration Setup

Guide for connecting Haya to Microsoft Teams using the Bot Framework SDK.

## Overview

The Teams integration uses the Bot Framework SDK (`botbuilder`) with an HTTP webhook endpoint, which means:
- Requires a publicly accessible URL (or ngrok for development)
- Microsoft Teams sends messages to your `/api/messages` endpoint
- Uses Azure Bot registration for authentication

## Prerequisites

- An Azure account with an active subscription
- A Microsoft 365 tenant with Teams enabled
- Haya installed and running

## Step 1: Create an Azure Bot registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Search for **Azure Bot** and click **Create**
3. Fill in the details:
   - **Bot handle**: A unique name (e.g., "haya-assistant")
   - **Subscription**: Your Azure subscription
   - **Resource group**: Create new or use existing
   - **Type of App**: Single Tenant
4. Click **Review + create**, then **Create**

## Step 2: Get the app credentials

1. Once the bot is created, go to the bot resource
2. Navigate to **Configuration**
3. Copy the **Microsoft App ID** -- this is your `TEAMS_APP_ID`
4. Click **Manage Password** next to Microsoft App ID
5. Click **New client secret**, add a description, and click **Add**
6. Copy the secret value immediately -- this is your `TEAMS_APP_PASSWORD`
7. Go to **Overview** and note your **Directory (tenant) ID** -- this is your `TEAMS_TENANT_ID`

## Step 3: Configure the messaging endpoint

1. In the bot resource, go to **Configuration**
2. Set the **Messaging endpoint** to your server URL:
   - Production: `https://your-domain.com/api/messages`
   - Development: Use ngrok (`ngrok http 3978`) and set `https://<id>.ngrok.io/api/messages`
3. Click **Apply**

## Step 4: Enable the Teams channel

1. In the bot resource, go to **Channels**
2. Click **Microsoft Teams**
3. Accept the terms of service
4. Click **Apply**

## Step 5: Configure Haya

Add the credentials to your `.env` file:

```bash
TEAMS_APP_ID=your-app-id
TEAMS_APP_PASSWORD=your-app-password
TEAMS_TENANT_ID=your-tenant-id
```

## Step 6: Start Haya

```bash
pnpm dev start
```

The Teams channel will start an HTTP server on port 3978 (configurable) and listen for messages at `/api/messages`.

## Step 7: Test the connection

1. In Teams, search for your bot by the name you registered
2. Start a chat with the bot
3. Send a message and verify you get a response

## How it works

### Session routing

Messages are routed to sessions based on conversation type:
- **Personal (DM)**: Session key is `teams:dm:<user-id>`
- **Channel/Group**: Session key is `teams:channel:<conversation-id>`

This means each DM conversation and each channel gets its own session with isolated history.

### Prompt injection protection

All inbound Teams messages are wrapped with `wrapExternalContent()` before being passed to the AI. This applies:
- Boundary markers (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`)
- Suspicious pattern detection
- Security warning blocks

There is no way to bypass this protection.

### Configuration

The Teams channel resolves its configuration from environment variables. You can customize the env var names in the config file:

```json
{
  "channels": {
    "teams": {
      "appIdEnvVar": "TEAMS_APP_ID",
      "appPasswordEnvVar": "TEAMS_APP_PASSWORD",
      "tenantIdEnvVar": "TEAMS_TENANT_ID"
    }
  }
}
```

The HTTP port defaults to 3978 and can be overridden via the `port` setting.

## Troubleshooting

### "Required environment variable not set"

Make sure all three Teams environment variables are set in your `.env` file.

### Bot not responding

1. Verify the messaging endpoint URL is correct and publicly accessible
2. Check that the Azure Bot registration has the Teams channel enabled
3. Check Haya logs for connection or authentication errors

### "Unauthorized" or authentication errors

1. Verify `TEAMS_APP_ID` and `TEAMS_APP_PASSWORD` match the Azure Bot registration
2. Ensure the client secret has not expired
3. Check that `TEAMS_TENANT_ID` matches your Azure AD tenant
