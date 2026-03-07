#!/bin/sh

# Write yt-dlp config with bgutil if available
CONFIG_DIR="/etc/yt-dlp"
mkdir -p "$CONFIG_DIR"

cat > "$CONFIG_DIR/config" <<EOF
--js-runtimes node
--remote-components ejs:github
EOF

if [ -n "$BGUTIL_BASE_URL" ]; then
  echo "--extractor-args youtubepot-bgutilhttp:base_url=$BGUTIL_BASE_URL" >> "$CONFIG_DIR/config"
  echo "[entrypoint] yt-dlp PO Token provider: $BGUTIL_BASE_URL"
fi

if [ -n "$YTDLP_COOKIES_FILE" ]; then
  echo "--cookies $YTDLP_COOKIES_FILE" >> "$CONFIG_DIR/config"
  echo "[entrypoint] yt-dlp cookies file enabled: $YTDLP_COOKIES_FILE"
elif [ -n "$YTDLP_COOKIES_FROM_BROWSER" ]; then
  echo "--cookies-from-browser $YTDLP_COOKIES_FROM_BROWSER" >> "$CONFIG_DIR/config"
  echo "[entrypoint] yt-dlp browser cookies enabled: $YTDLP_COOKIES_FROM_BROWSER"
fi

if [ -n "$YTDLP_USER_AGENT" ]; then
  echo "--user-agent $YTDLP_USER_AGENT" >> "$CONFIG_DIR/config"
fi

echo "[entrypoint] yt-dlp config:"
cat "$CONFIG_DIR/config"

exec bun run start
