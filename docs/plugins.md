# Plugin Development Guide

How to build plugins for Haya using the plugin SDK.

## Overview

Plugins extend Haya's functionality by registering tools (for AI function calling) and hooks (for event handling). Plugins run in sandboxed `worker_threads` with restricted permissions.

## Plugin structure

A plugin is a module that exports a `PluginDefinition`:

```typescript
import type { PluginDefinition } from "@haya/plugin-sdk";

const plugin: PluginDefinition = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  permissions: {
    fileSystemRead: ["/tmp/my-plugin"],
    network: true,
  },
  register: (api) => {
    api.registerTool({
      name: "my-tool",
      description: "Does something useful",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "Input text" },
        },
        required: ["input"],
      },
      execute: async (args) => {
        return `Result for: ${args.input}`;
      },
    });

    api.registerHook("chat.before", async (payload) => {
      api.logger.info(`Chat message incoming: ${payload.sessionId}`);
    });
  },
};

export default plugin;
```

## PluginDefinition interface

```typescript
interface PluginDefinition {
  id: string;                       // Unique identifier
  name: string;                     // Human-readable name
  version?: string;                 // Semver version
  permissions?: PluginPermissions;  // Required permissions
  register: (api: PluginApi) => void | Promise<void>;
}
```

## Permissions

Plugins declare the permissions they need. The sandbox enforces these via Node.js 22+ `--experimental-permission` flags:

```typescript
interface PluginPermissions {
  fileSystemRead?: string[];   // Paths the plugin can read
  fileSystemWrite?: string[];  // Paths the plugin can write
  network?: boolean;           // Whether the plugin can make network requests
  childProcess?: boolean;      // Whether the plugin can spawn child processes
}
```

By default, plugins have no filesystem, network, or process access. Only declare what you need.

## Plugin API

The `PluginApi` is passed to the `register` function:

```typescript
interface PluginApi {
  registerTool: (tool: AgentTool) => void;
  registerHook: (event: string, handler: HookHandler) => void;
  logger: PluginLogger;
}
```

### Registering tools

Tools are exposed to the AI model for function calling:

```typescript
api.registerTool({
  name: "weather",
  description: "Get current weather for a location",
  parameters: {
    type: "object",
    properties: {
      location: { type: "string", description: "City name" },
    },
    required: ["location"],
  },
  execute: async (args) => {
    const data = await fetchWeather(args.location);
    return JSON.stringify(data);
  },
});
```

### Registering hooks

Hooks are called when specific events occur:

```typescript
api.registerHook("chat.before", async (payload) => {
  // Called before a chat message is processed
  api.logger.info("Processing chat message");
});

api.registerHook("chat.after", async (payload) => {
  // Called after a chat response is generated
});
```

### Logging

Use the provided logger instead of `console.log`:

```typescript
api.logger.info("Plugin initialized");
api.logger.warn("Rate limit approaching");
api.logger.error("Failed to fetch data");
api.logger.debug("Processing step 3");
```

## Sandbox architecture

Plugins run in isolated `worker_threads`:

```
Host process
  |
  +-- Plugin Worker (worker_thread)
  |     --experimental-permission
  |     --allow-fs-read=/tmp/my-plugin
  |     Communication via MessagePort
  |
  +-- Plugin Worker (another plugin)
        --experimental-permission
        --allow-fs-read=/data
        --allow-net
```

### Message protocol

Host and worker communicate via structured messages:

**Host -> Worker:**
- `init` -- Initialize the plugin
- `hook` -- Dispatch a hook event
- `tool-call` -- Execute a registered tool
- `shutdown` -- Graceful shutdown

**Worker -> Host:**
- `ready` -- Plugin loaded, sends manifest
- `register-tool` -- Register a tool with the host
- `register-hook` -- Subscribe to a hook event
- `tool-result` -- Return tool execution result
- `log` -- Forward log messages to host logger

## Creating a workspace package

For a new plugin as a workspace package:

```bash
mkdir -p extensions/my-plugin/src
```

`extensions/my-plugin/package.json`:

```json
{
  "name": "@haya/my-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@haya/core": "workspace:*",
    "@haya/plugin-sdk": "workspace:*"
  }
}
```

Then run `pnpm install` to link the workspace.

## Security considerations

- Never use `eval()` or `new Function()`
- Never use `shell: true` in child processes
- External content from messaging channels must be wrapped with `wrapExternalContent()` before passing to the AI
- Declare minimal permissions -- only request what you need
- Secrets should come from environment variables, not hardcoded values
