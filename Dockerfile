FROM node:22-slim AS base

# Install system deps: ffmpeg, yt-dlp, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
    python3 \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source code
COPY app/ ./app/
COPY lib/ ./lib/
COPY models/ ./models/
COPY public/ ./public/
COPY vite.config.ts tsconfig.json ./

# Create runtime directories
RUN mkdir -p tmp public/outputs

# Build for production
RUN bun run build

EXPOSE 9977

ENV PORT=9977
ENV NODE_ENV=production

CMD ["bun", "run", "start"]
