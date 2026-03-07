FROM node:22-slim AS base

# Install system deps: ffmpeg only (no Python, no yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY app/ ./app/
COPY lib/ ./lib/
COPY models/ ./models/
COPY public/ ./public/
COPY vite.config.ts tsconfig.json ./

RUN mkdir -p tmp public/outputs

RUN bun run build

EXPOSE 9977

ENV PORT=9977
ENV NODE_ENV=production

CMD ["bun", "run", "start"]
