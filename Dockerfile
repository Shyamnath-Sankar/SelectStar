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
FROM node:20-slim AS deps

# build-essential + python3 are needed to compile better-sqlite3's native addon.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy lockfile + package.json first for layer caching.
COPY package.json bun.lock* ./
COPY prisma ./prisma

# Install with npm (works everywhere; bun.lock is used for resolution info).
RUN npm install


# ---- Stage 2: builder ---------------------------------------------------
FROM node:20-slim AS builder

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

# ---- Stage 3: runner ----------------------------------------------------
FROM node:20-slim AS runner

WORKDIR /app

# Minimal runtime: only what the standalone server needs.
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# App database (Prisma SQLite) — mount a persistent volume here on Render.
ENV DATABASE_URL=file:/app/db/custom.db
# Demo database path.
ENV DEMO_DB_PATH=/app/db/demo.db
# LLM config — defaults are OpenCode Zen; override in Render dashboard.
ENV LLM_BASE_URL=https://opencode.ai/zen/v1
ENV LLM_API_KEY=sk-XRH17i30ZCvPJg6tSmzHCUpGyyI4FribE4F3kDLUhIxN4odGDs2G2sGCkfClsK2c
ENV LLM_MODEL=big-pickle

# Create the db directory (Render mounts a persistent disk here).
RUN mkdir -p /app/db

# Copy the standalone server + traced node_modules (includes better-sqlite3 + pg).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma schema + migrations + the seed script (for first-run init).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts/seed-demo.js ./scripts/seed-demo.js
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy the demo DB seeded during build.
COPY --from=builder /app/db/demo.db ./db/demo.db

# Entrypoint ensures the app DB schema exists, then starts the server.
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

# Render sends SIGTERM for graceful shutdown; Node handles it.
ENTRYPOINT ["./docker-entrypoint.sh"]
