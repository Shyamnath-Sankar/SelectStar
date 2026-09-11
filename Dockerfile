# ─────────────────────────────────────────────────────────────────────────
# SelectStar — Dockerfile for Render / any container platform
#
# Multi-stage build:
#   1. deps    — install dependencies (with build tools for native modules)
#   2. builder — build Next.js standalone + generate Prisma client + seed demo DB
#   3. runner  — minimal runtime image
#
# The LLM credentials are baked in as defaults (OpenCode Zen) but can be
# overridden at runtime with LLM_BASE_URL / LLM_API_KEY / LLM_MODEL env vars.
# ─────────────────────────────────────────────────────────────────────────

# ---- Stage 1: deps ------------------------------------------------------
# NOTE: Node 22 (matches local verified env). Node 20 builds serve pages
# but return empty 405 for every /api route handler at runtime.
FROM node:22-slim AS deps

# build-essential + python3 are needed to compile better-sqlite3's native addon.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json + lockfile first for layer caching.
# NOTE: package-lock.json MUST be copied and installed with `npm ci`.
# A floating `npm install` without the lockfile installs newer deps
# (e.g. next 16.3.x) than the lockfile pins (next 16.2.10); combined
# with `npm prune` later this produced an image whose compiled chunks
# referenced APIs missing from the runtime copy — every /api route
# returned an empty 405 at runtime.
COPY package.json package-lock.json bun.lock* ./
COPY prisma ./prisma

# Deterministic install from the lockfile (matches local verified env).
RUN npm ci


# ---- Stage 2: builder ---------------------------------------------------
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client (downloads the query engine for linux).
RUN npx prisma generate

# Build Next.js standalone (output: .next/standalone/).
RUN npm run build

# Seed the demo database so the app works out-of-the-box.
RUN mkdir -p db && node scripts/seed-demo.js

# NOTE: no `npm prune` here. Pruning after the build re-resolves the
# dependency tree and can swap versions out from under the compiled
# output (build-time vs runtime skew). The runner copies node_modules
# as-is; standalone tracing already keeps the needed subset.


# ---- Stage 3: runner ----------------------------------------------------
FROM node:22-slim AS runner

# openssl is required so Prisma can detect the libssl version
# (silences the "failed to detect libssl/openssl" warning).
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Minimal runtime: only what the standalone server needs.
ENV NODE_ENV=production
# PORT default for local `docker run` without -e PORT.
# On Render this is overridden by the platform's own $PORT —
# do NOT add a hardcoded PORT to render.yaml (health check fails).
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# App database (Prisma SQLite) — mount a persistent volume here on Render.
ENV DATABASE_URL=file:/app/db/custom.db
# Demo database path.
ENV DEMO_DB_PATH=/app/db/demo.db
# LLM config — defaults are Groq; override in Render dashboard.
ENV LLM_BASE_URL=https://api.groq.com/openai/v1
ENV LLM_API_KEY=""
ENV LLM_MODEL=openai/gpt-oss-120b

# Create the db directory (Render mounts a persistent disk here).
RUN mkdir -p /app/db

# Copy the standalone server + traced node_modules (includes better-sqlite3 + pg).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma schema + migrations + the seed script (for first-run init).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts/seed-demo.js ./scripts/seed-demo.js

# Copy all pruned node_modules (ensures prisma CLI and all transitive deps like 'effect' are present).
COPY --from=builder /app/node_modules ./node_modules

# Copy the demo DB seeded during build.
COPY --from=builder /app/db/demo.db ./db/demo.db

# Entrypoint ensures the app DB schema exists, then starts the server.
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

# Render sends SIGTERM for graceful shutdown; Node handles it.
ENTRYPOINT ["./docker-entrypoint.sh"]
