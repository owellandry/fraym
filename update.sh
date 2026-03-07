#!/bin/bash
# fraym update — pull, build, deploy, and setup CLI
# Usage: bash update.sh  (or: fraym update)

set -e

# Resolve symlinks
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
REPO_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
cd "$REPO_DIR"

R='\033[0;31m'  G='\033[0;32m'  C='\033[0;36m'
D='\033[2m'     B='\033[1m'     N='\033[0m'

echo ""
echo -e "  ${C}${B}f${N}${B}raym${N} ${D}update${N}"
echo ""

# 1. Pull
echo -e "  ${C}→${N} Descargando cambios..."
git pull --ff-only
echo ""

# 2. Setup CLI + hooks (always, in case scripts changed)
chmod +x scripts/fraym.sh scripts/setup-cli.sh scripts/install-hooks.sh 2>/dev/null
bash scripts/setup-cli.sh 2>/dev/null || true
bash scripts/install-hooks.sh 2>/dev/null || true

# 3. Build
echo -e "  ${C}→${N} Reconstruyendo imagen..."
docker compose build --no-cache
echo ""

# 4. Deploy
echo -e "  ${C}→${N} Reiniciando servicio..."
docker compose up -d
echo ""

COMMIT=$(git rev-parse --short HEAD)
echo -e "  ${G}✓${N} fraym actualizado a ${B}${COMMIT}${N}"

if command -v fraym &>/dev/null; then
  echo -e "  ${G}✓${N} CLI disponible: ${B}fraym${N}"
else
  echo -e "  ${D}  Tip: ejecuta${N} ${C}bash scripts/fraym.sh help${N} ${D}para ver comandos${N}"
fi
echo ""
