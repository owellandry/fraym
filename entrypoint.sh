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

echo "[entrypoint] yt-dlp config:"
cat "$CONFIG_DIR/config"

exec bun run start
