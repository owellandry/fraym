#!/bin/bash
# Auto-setup fraym CLI — runs on git pull, install, or manually
# Creates /usr/local/bin/fraym symlink pointing to this repo's CLI

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAYM_SH="$SCRIPT_DIR/fraym.sh"

# Ensure executable
chmod +x "$FRAYM_SH" 2>/dev/null

# Create symlink (silently skip if no permissions)
if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
  ln -sf "$FRAYM_SH" /usr/local/bin/fraym 2>/dev/null
elif command -v sudo &>/dev/null; then
  sudo ln -sf "$FRAYM_SH" /usr/local/bin/fraym 2>/dev/null
fi
