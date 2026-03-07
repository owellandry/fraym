FROM node:22-slim AS base

# Install system deps: ffmpeg, yt-dlp, python3, bgutil plugin
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
    python3 \
    python3-pip \
  && pip3 install --break-system-packages yt-dlp bgutil-ytdlp-pot-provider \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# yt-dlp global config — use android client (no PO token needed for public videos)
RUN mkdir -p /root/.config/yt-dlp && \
    echo '--extractor-args youtube:player_client=android,web' > /root/.config/yt-dlp/config

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY app/ ./app/
COPY lib/ ./lib/
COPY models/ ./models/
COPY public/ ./public/
COPY vite.config.ts tsconfig.json entrypoint.sh ./

RUN mkdir -p tmp public/outputs && chmod +x entrypoint.sh

RUN bun run build

EXPOSE 9977

ENV PORT=9977
ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
