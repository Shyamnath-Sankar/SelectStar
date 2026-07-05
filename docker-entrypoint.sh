#!/bin/sh
# Docker entrypoint — ensures the app DB + demo DB exist, then starts the server.
set -e

# App database (Prisma SQLite). Use a path under /app/db so it can be a
# mounted persistent volume on Render.
export DATABASE_URL="${DATABASE_URL:-file:/app/db/custom.db}"
mkdir -p /app/db

# Push the Prisma schema if the app DB doesn't exist yet (creates tables).
if [ ! -f /app/db/custom.db ]; then
  echo "[entrypoint] Initializing app database…"
  npx prisma db push --skip-generate --accept-data-loss || \
    node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss
fi


# Seed the demo e-commerce database if it doesn't exist (first run on a fresh
# persistent disk, e.g. after creating the Render service).
if [ ! -f /app/db/demo.db ]; then
  echo "[entrypoint] Seeding demo database…"
  node scripts/seed-demo.js 2>/dev/null || true
fi

echo "[entrypoint] Starting SelectStar on port ${PORT:-3000}…"
exec node server.js
