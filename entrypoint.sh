#!/bin/sh
set -e

CONFIG="/root/.config/yt-dlp/config"

# Append bgutil extractor args to yt-dlp config at runtime
if [ -n "$BGUTIL_BASE_URL" ]; then
  echo "--extractor-args youtubepot-bgutilhttp:base_url=$BGUTIL_BASE_URL" >> "$CONFIG"
  echo "[entrypoint] yt-dlp bgutil provider: $BGUTIL_BASE_URL"
fi

echo "[entrypoint] yt-dlp config:"
cat "$CONFIG"

exec bun run start
