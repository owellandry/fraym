#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}  fraym${NC} — De YouTube a Shorts en un click"
echo ""

# Check docker
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Error: Docker no está instalado.${NC}"
  echo "Instálalo con: curl -fsSL https://get.docker.com | sh"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  echo -e "${RED}Error: Docker Compose no está disponible.${NC}"
  exit 1
fi

INSTALL_DIR="${FRAYM_DIR:-$HOME/fraym}"

echo -e "${CYAN}→${NC} Instalando en ${BOLD}$INSTALL_DIR${NC}"

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo -e "${CYAN}→${NC} Actualizando..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
else
  echo -e "${CYAN}→${NC} Descargando..."
  git clone https://github.com/owellandry/fraym.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Setup .env
if [ ! -f .env ]; then
  echo ""
  echo -e "${BOLD}Se necesita una API key de OpenRouter para la detección con IA.${NC}"
  echo -e "Obtén una gratis en: ${CYAN}https://openrouter.ai/keys${NC}"
  echo ""
  read -p "OPENROUTER_API_KEY (Enter para saltar): " API_KEY
  if [ -n "$API_KEY" ]; then
    echo "OPENROUTER_API_KEY=$API_KEY" > .env
    echo -e "${GREEN}✓${NC} .env creado"
  else
    echo "OPENROUTER_API_KEY=" > .env
    echo -e "${CYAN}→${NC} Sin API key — la detección de momentos usará heurísticas"
  fi
fi

# Build and start
echo ""
echo -e "${CYAN}→${NC} Construyendo imagen Docker..."
docker compose up -d --build

echo ""
echo -e "${GREEN}${BOLD}✓ fraym está corriendo${NC}"
echo ""
echo -e "  ${BOLD}URL:${NC}  http://localhost:9977"
echo -e "  ${BOLD}Dir:${NC}  $INSTALL_DIR"
echo ""
echo -e "  Comandos útiles:"
echo -e "    docker compose -f $INSTALL_DIR/docker-compose.yml logs -f    ${CYAN}# Ver logs${NC}"
echo -e "    docker compose -f $INSTALL_DIR/docker-compose.yml down        ${CYAN}# Detener${NC}"
echo -e "    docker compose -f $INSTALL_DIR/docker-compose.yml up -d       ${CYAN}# Reiniciar${NC}"
echo ""
