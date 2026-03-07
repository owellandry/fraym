#!/bin/bash
# Install git hooks for fraym — run once after clone or by setup-cli

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_DIR/.git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  exit 0
fi

# post-merge hook — runs after every git pull
cat > "$HOOKS_DIR/post-merge" << 'HOOK'
#!/bin/bash
# Auto-install fraym CLI after git pull
REPO_ROOT="$(git rev-parse --show-toplevel)"
bash "$REPO_ROOT/scripts/setup-cli.sh" 2>/dev/null
HOOK

chmod +x "$HOOKS_DIR/post-merge"
