#!/bin/sh
set -e

echo "[entrypoint] yt-dlp config:"
cat /root/.config/yt-dlp/config

exec bun run start
