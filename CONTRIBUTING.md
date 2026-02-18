# Contributing to Haya

## Development setup

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env` and fill in values
4. Run tests: `pnpm test`
5. Type check: `pnpm lint`

## Monorepo structure

This is a pnpm workspace monorepo:

- `packages/core/` -- Main application
- `packages/plugin-sdk/` -- Plugin SDK
- `extensions/slack/` -- Slack channel integration

## Workflow

1. Create a feature branch from `main`
2. Make changes
3. Run `pnpm lint && pnpm test` before committing
4. Create a pull request

## Code standards

### TypeScript

- Strict mode enabled
- ES2024 target, NodeNext module resolution
- Use `node:` prefix for all built-in module imports
- Zod for all external input validation

### Security rules

These are non-negotiable and enforced by the security audit (`pnpm audit:security`):

- No `eval()` or `new Function()` anywhere
- No `shell: true` in child process calls -- use `safeExecSync()` from `security/command-exec.ts`
- No `"none"` auth mode
- All external content must go through `wrapExternalContent()`
- Secrets must come from environment variables, never hardcoded
- Use `safeEqualSecret()` for secret comparison (constant-time)
- Config files use `0o600` permissions
- Use `node:` prefix for built-in module imports

### Testing

- Vitest for all tests
- Co-locate test files with source: `module.ts` / `module.test.ts`
- Mock external dependencies, not internal modules
- Test files are included from both `packages/*/src/**/*.test.ts` and `extensions/*/src/**/*.test.ts`

### Commit messages

Use conventional commits:

```
feat: add new feature
fix: fix a bug
refactor: refactor code
docs: update documentation
test: add tests
```

## Adding a new channel

1. Create a new workspace under `extensions/your-channel/`
2. Implement the `ChannelPlugin` interface from `@haya/core`
3. Register the channel in the gateway startup
4. See [docs/plugins.md](docs/plugins.md) for the plugin development guide

## Running the security audit

```bash
pnpm audit:security
```

This checks all 20 vulnerability classes. All checks must pass before merging.
