# Dockerfile — SelectStar
# Used as a backup deploy option if Render's native Node runtime isn't suitable.
# Render's native runtime is recommended for this project — see render.yaml.

FROM oven/bun:1.3 AS base
WORKDIR /app

# Install deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Build
RUN bun run db:generate
RUN bun run build

# Persistent volume for the SQLite database
VOLUME ["/app/db"]

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["bun", "run", "start"]
