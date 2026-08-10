FROM oven/bun:1.3 AS base
WORKDIR /app

# Install the Docker CLI so the Mavino sandbox (run_code tool) can spawn
# isolated containers via the mounted Docker socket. Only the CLI is needed —
# the daemon runs on the host. gVisor (runsc) runtime provides kernel isolation.
# Also install ffmpeg (audio/video processing for lecture pipeline) and
# tesseract-ocr (fallback slide text extraction when vision LLM unavailable).
RUN apt-get update -qq && apt-get install -y -qq docker.io ffmpeg tesseract-ocr && rm -rf /var/lib/apt/lists/*

# Install deps
COPY package.json bunfig.toml ./
COPY patches ./patches
COPY prisma ./prisma
RUN bun install
RUN bunx prisma generate

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Ensure data + uploads dirs exist
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000

# Run migrations on container start, then start server
CMD ["sh", "-c", "bunx prisma migrate deploy && bun src/index.ts"]
