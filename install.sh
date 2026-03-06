#!/bin/bash
set -e

# ─── Colors ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n  ${CYAN}${BOLD}[$1/5]${NC} $2"; }
ok()   { echo -e "       ${GREEN}✓${NC} $1"; }
warn() { echo -e "       ${YELLOW}!${NC} $1"; }
fail() { echo -e "\n  ${RED}${BOLD}✗${NC} $1\n"; exit 1; }

clear
echo ""
echo -e "  ${BOLD}┌─────────────────────────────────────┐${NC}"
echo -e "  ${BOLD}│${NC}                                     ${BOLD}│${NC}"
echo -e "  ${BOLD}│${NC}   ${CYAN}f${NC}${BOLD}raym${NC}                              ${BOLD}│${NC}"
echo -e "  ${BOLD}│${NC}   ${DIM}De YouTube a Shorts en un click${NC}    ${BOLD}│${NC}"
echo -e "  ${BOLD}│${NC}                                     ${BOLD}│${NC}"
echo -e "  ${BOLD}└─────────────────────────────────────┘${NC}"
echo ""

# ─── Step 1: Check requirements ───
step 1 "Verificando requisitos..."

if ! command -v docker &> /dev/null; then
  fail "Docker no está instalado.\n       Instálalo con: ${CYAN}curl -fsSL https://get.docker.com | sh${NC}"
fi
ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' || echo 'OK')"

if ! docker compose version &> /dev/null; then
  fail "Docker Compose no disponible."
fi
ok "Docker Compose $(docker compose version --short 2>/dev/null || echo 'OK')"

if ! command -v git &> /dev/null; then
  fail "Git no está instalado.\n       Instálalo con: ${CYAN}apt install git${NC}"
fi
ok "Git disponible"

# ─── Step 2: Download ───
step 2 "Descargando fraym..."

INSTALL_DIR="${FRAYM_DIR:-$HOME/fraym}"

if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
  ok "Actualizado en ${DIM}$INSTALL_DIR${NC}"
else
  git clone --quiet https://github.com/owellandry/fraym.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  ok "Clonado en ${DIM}$INSTALL_DIR${NC}"
fi

# ─── Step 3: Configure ───
step 3 "Configurando..."

NEED_KEY=false

if [ -f .env ]; then
  EXISTING_KEY=$(grep 'OPENROUTER_API_KEY=' .env 2>/dev/null | cut -d'=' -f2-)
  if [ -n "$EXISTING_KEY" ]; then
    ok "API key encontrada en .env"
  else
    NEED_KEY=true
  fi
else
  NEED_KEY=true
fi

if [ "$NEED_KEY" = true ]; then
  echo ""
  echo -e "       ${BOLD}OpenRouter API Key${NC} ${DIM}(para detección de momentos con IA)${NC}"
  echo -e "       ${DIM}Obtén una gratis en:${NC} ${CYAN}https://openrouter.ai/keys${NC}"
  echo ""
  printf "       Pega tu key (Enter para saltar): "
  API_KEY=""
  read API_KEY </dev/tty || true
  if [ -n "$API_KEY" ]; then
    echo "OPENROUTER_API_KEY=$API_KEY" > .env
    ok "API key guardada"
  else
    echo "OPENROUTER_API_KEY=" > .env
    warn "Sin API key — se usarán heurísticas (menos precisión)"
  fi
fi

# ─── Step 4: Build ───
step 4 "Construyendo imagen Docker..."
echo -e "       ${DIM}Esto puede tomar unos minutos la primera vez...${NC}"
echo ""

docker compose build --quiet 2>/dev/null || docker compose build

ok "Imagen construida"

# ─── Step 5: Launch ───
step 5 "Iniciando servicio..."

docker compose up -d

ok "Contenedor corriendo"

# ─── Get server IP ───
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

# ─── Done ───
echo ""
echo -e "  ${GREEN}${BOLD}┌─────────────────────────────────────┐${NC}"
echo -e "  ${GREEN}${BOLD}│${NC}                                     ${GREEN}${BOLD}│${NC}"
echo -e "  ${GREEN}${BOLD}│${NC}   ${GREEN}${BOLD}✓ fraym está listo${NC}                 ${GREEN}${BOLD}│${NC}"
echo -e "  ${GREEN}${BOLD}│${NC}                                     ${GREEN}${BOLD}│${NC}"
echo -e "  ${GREEN}${BOLD}│${NC}   ${BOLD}Local:${NC}    http://localhost:9977    ${GREEN}${BOLD}│${NC}"
echo -e "  ${GREEN}${BOLD}│${NC}   ${BOLD}Red:${NC}      http://${SERVER_IP}:9977  ${GREEN}${BOLD}│${NC}"
echo -e "  ${GREEN}${BOLD}│${NC}                                     ${GREEN}${BOLD}│${NC}"
echo -e "  ${GREEN}${BOLD}└─────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${DIM}Comandos:${NC}"
echo -e "    ${BOLD}fraym logs${NC}      → docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo -e "    ${BOLD}fraym stop${NC}      → docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo -e "    ${BOLD}fraym restart${NC}   → docker compose -f $INSTALL_DIR/docker-compose.yml up -d"
echo -e "    ${BOLD}fraym update${NC}    → curl -fsSL https://raw.githubusercontent.com/owellandry/fraym/master/install.sh | bash"
echo ""
