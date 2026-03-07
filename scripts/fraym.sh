#!/bin/bash
# ─────────────────────────────────────────────
#  fraym CLI — manage your fraym instance
# ─────────────────────────────────────────────

set -e

# Colors
R='\033[0;31m'    G='\033[0;32m'    Y='\033[0;33m'
C='\033[0;36m'    M='\033[0;35m'    D='\033[2m'
B='\033[1m'       N='\033[0m'

# Find fraym install dir
FRAYM_DIR="${FRAYM_DIR:-$HOME/fraym}"
COMPOSE="docker compose -f $FRAYM_DIR/docker-compose.yml"

banner() {
  echo ""
  echo -e "  ${D}┌──────────────────────────────────────┐${N}"
  echo -e "  ${D}│${N}   ${C}${B}f${N}${B}raym${N} ${D}CLI${N}                         ${D}│${N}"
  echo -e "  ${D}└──────────────────────────────────────┘${N}"
  echo ""
}

info()    { echo -e "  ${C}●${N} $1"; }
success() { echo -e "  ${G}✓${N} $1"; }
warn()    { echo -e "  ${Y}!${N} $1"; }
err()     { echo -e "  ${R}✗${N} $1"; }
step()    { echo -e "  ${M}→${N} ${B}$1${N}"; }

check_dir() {
  if [ ! -d "$FRAYM_DIR" ]; then
    err "fraym no encontrado en $FRAYM_DIR"
    echo -e "  ${D}Instala con:${N} ${C}curl -fsSL https://raw.githubusercontent.com/owellandry/fraym/main/install.sh | bash${N}"
    exit 1
  fi
}

cmd_start() {
  check_dir
  step "Iniciando fraym..."
  cd "$FRAYM_DIR"
  $COMPOSE up -d
  echo ""
  success "fraym iniciado"
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
  info "Local:  ${B}http://localhost:9977${N}"
  info "Red:    ${B}http://${SERVER_IP}:9977${N}"
  echo ""
}

cmd_stop() {
  check_dir
  step "Deteniendo fraym..."
  cd "$FRAYM_DIR"
  $COMPOSE down
  echo ""
  success "fraym detenido"
  echo ""
}

cmd_restart() {
  check_dir
  step "Reiniciando fraym..."
  cd "$FRAYM_DIR"
  $COMPOSE restart
  echo ""
  success "fraym reiniciado"
  echo ""
}

cmd_update() {
  check_dir
  step "Actualizando fraym..."
  cd "$FRAYM_DIR"

  echo ""
  info "Descargando cambios..."
  git fetch origin 2>/dev/null
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null)

  if [ "$LOCAL" = "$REMOTE" ]; then
    success "Ya tienes la ultima version"
    echo ""
    return
  fi

  git pull --ff-only
  echo ""

  info "Reconstruyendo imagen..."
  $COMPOSE build --no-cache
  echo ""

  info "Reiniciando servicio..."
  $COMPOSE up -d
  echo ""

  NEW_HASH=$(git rev-parse --short HEAD)
  success "Actualizado a ${B}${NEW_HASH}${N}"
  echo ""
}

cmd_logs() {
  check_dir
  LINES="${2:-100}"
  step "Mostrando logs (${LINES} lineas)..."
  echo ""
  cd "$FRAYM_DIR"
  $COMPOSE logs -f --tail="$LINES"
}

cmd_status() {
  check_dir
  step "Estado de fraym"
  echo ""

  cd "$FRAYM_DIR"

  # Git info
  BRANCH=$(git branch --show-current 2>/dev/null || echo "?")
  COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
  info "Branch:  ${B}${BRANCH}${N} ${D}(${COMMIT})${N}"

  # Container status
  RUNNING=$($COMPOSE ps --format "{{.State}}" 2>/dev/null | head -1)
  if [ "$RUNNING" = "running" ]; then
    success "Contenedor: ${G}running${N}"

    # Uptime
    STARTED=$($COMPOSE ps --format "{{.CreatedAt}}" 2>/dev/null | head -1)
    if [ -n "$STARTED" ]; then
      info "Inicio:  ${D}${STARTED}${N}"
    fi
  else
    warn "Contenedor: ${Y}${RUNNING:-detenido}${N}"
  fi

  # Disk usage
  TMP_SIZE=$(du -sh "$FRAYM_DIR/tmp" 2>/dev/null | cut -f1 || echo "0")
  OUT_SIZE=$(du -sh "$FRAYM_DIR/public/outputs" 2>/dev/null | cut -f1 || echo "0")
  info "Temp:    ${D}${TMP_SIZE}${N}"
  info "Outputs: ${D}${OUT_SIZE}${N}"

  # Port
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
  info "URL:     ${B}http://${SERVER_IP}:9977${N}"
  echo ""
}

cmd_clean() {
  check_dir
  step "Limpiando archivos temporales..."
  echo ""

  cd "$FRAYM_DIR"

  TMP_COUNT=$(find tmp/ -type f 2>/dev/null | wc -l)
  OUT_COUNT=$(find public/outputs/ -type f 2>/dev/null | wc -l)

  if [ "$TMP_COUNT" -gt 0 ] || [ "$OUT_COUNT" -gt 0 ]; then
    rm -rf tmp/* public/outputs/*
    success "Eliminados: ${B}${TMP_COUNT}${N} temporales, ${B}${OUT_COUNT}${N} outputs"
  else
    info "Nada que limpiar"
  fi
  echo ""
}

cmd_env() {
  check_dir
  step "Variables de entorno"
  echo ""

  cd "$FRAYM_DIR"
  if [ -f .env ]; then
    while IFS= read -r line; do
      # Skip comments and empty
      [[ -z "$line" || "$line" == \#* ]] && continue
      KEY=$(echo "$line" | cut -d'=' -f1)
      VAL=$(echo "$line" | cut -d'=' -f2-)
      if [ -n "$VAL" ]; then
        MASKED="${VAL:0:4}$(printf '%*s' $((${#VAL}-4)) '' | tr ' ' '*')"
        info "${B}${KEY}${N} = ${D}${MASKED}${N}"
      else
        warn "${B}${KEY}${N} = ${R}(vacio)${N}"
      fi
    done < .env
  else
    warn "No se encontro .env"
  fi
  echo ""
}

cmd_help() {
  banner
  echo -e "  ${B}Uso:${N} fraym ${C}<comando>${N} ${D}[opciones]${N}"
  echo ""
  echo -e "  ${B}Comandos:${N}"
  echo ""
  echo -e "    ${C}start${N}       Inicia el servicio"
  echo -e "    ${C}stop${N}        Detiene el servicio"
  echo -e "    ${C}restart${N}     Reinicia el servicio"
  echo -e "    ${C}update${N}      Actualiza a la ultima version (git pull + rebuild)"
  echo -e "    ${C}logs${N} ${D}[n]${N}    Muestra logs en tiempo real (default: 100 lineas)"
  echo -e "    ${C}status${N}      Muestra estado del servicio"
  echo -e "    ${C}clean${N}       Elimina archivos temporales y outputs"
  echo -e "    ${C}env${N}         Muestra variables de entorno (enmascaradas)"
  echo -e "    ${C}help${N}        Muestra esta ayuda"
  echo ""
  echo -e "  ${D}Directorio: ${FRAYM_DIR}${N}"
  echo ""
}

# ─── Main ───
case "${1:-help}" in
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  restart)  cmd_restart ;;
  update)   cmd_update ;;
  logs)     cmd_logs "$@" ;;
  status)   cmd_status ;;
  clean)    cmd_clean ;;
  env)      cmd_env ;;
  help|-h|--help) cmd_help ;;
  *)
    err "Comando desconocido: ${B}$1${N}"
    echo -e "  ${D}Usa${N} ${C}fraym help${N} ${D}para ver los comandos disponibles${N}"
    echo ""
    exit 1
    ;;
esac
