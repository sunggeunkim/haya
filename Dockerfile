# ---- Build stage ----
FROM node:22-bookworm-slim AS build

# Enable corepack for pnpm (no curl|bash, no remote scripts)
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY extensions/slack/package.json ./extensions/slack/

# Install dependencies with frozen lockfile (reproducible builds)
RUN pnpm install --frozen-lockfile --prod=false

# Copy source code
COPY tsconfig.json tsdown.config.ts ./
COPY packages/ ./packages/
COPY extensions/ ./extensions/

# Build
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# ---- Production stage ----
FROM node:22-bookworm-slim AS production

# Enable corepack for pnpm in production
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=build /app/packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY --from=build /app/packages/plugin-sdk/src ./packages/plugin-sdk/src
COPY --from=build /app/extensions/slack/package.json ./extensions/slack/
COPY --from=build /app/extensions/slack/src ./extensions/slack/src
COPY --from=build /app/extensions/slack/node_modules ./extensions/slack/node_modules

# Create data directory for persistent state
RUN mkdir -p /app/data && chown -R node:node /app

# Security: run as non-root user
USER node

ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "try { const r = await fetch('http://localhost:' + (process.env.HAYA_PORT || 3120) + '/health'); process.exit(r.ok ? 0 : 1); } catch { process.exit(1); }"

EXPOSE 3120

# Start gateway — no --allow-unconfigured flag
# A token is auto-generated on first run if not configured
CMD ["node", "packages/core/dist/entry.js", "start", "--config", "/app/data/haya.json"]
