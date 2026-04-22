#!/usr/bin/env bash
# =============================================================================
# manage-service.sh  —  Update, uninstall, or check the DVD Library service
#
# Usage:
#   sudo bash systemd/manage-service.sh status
#   sudo bash systemd/manage-service.sh update    # pull latest files & restart
#   sudo bash systemd/manage-service.sh uninstall
#   sudo bash systemd/manage-service.sh logs       # tail live logs
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fatal() { echo -e "${RED}[FAIL]${RESET}  $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && fatal "Run as root: sudo bash $0 $*"

SERVICE_NAME="dvd-library"
APP_DEST="/opt/dvd-library"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CMD="${1:-status}"

case "$CMD" in

  status)
    systemctl status "$SERVICE_NAME" --no-pager
    ;;

  logs)
    journalctl -u "$SERVICE_NAME" -f --no-pager
    ;;

  update)
    info "Updating DVD Library app files…"
    rsync -a --delete \
      --exclude='.env' \
      --exclude='node_modules' \
      --exclude='frontend/posters' \
      --exclude='.git' \
      --exclude='db_data' \
      "$SRC_DIR/" "$APP_DEST/"

    info "Updating Node.js dependencies…"
    cd "$APP_DEST/backend"
    npm ci --omit=dev --silent
    cd "$SCRIPT_DIR"

    # Fix ownership
    APP_USER="dvdlib"
    chown -R root:"$APP_USER" "$APP_DEST"
    chown -R "$APP_USER:$APP_USER" "$APP_DEST/frontend/posters"
    chmod -R o-rwx "$APP_DEST"

    info "Restarting service…"
    systemctl restart "$SERVICE_NAME"
    sleep 2
    systemctl is-active --quiet "$SERVICE_NAME" && ok "Service restarted successfully" \
      || warn "Service may have failed — check: journalctl -u $SERVICE_NAME -n 30"
    ;;

  uninstall)
    warn "This will stop and remove the $SERVICE_NAME service."
    read -r -p "Are you sure? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }

    systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    ok "Service removed"

    read -r -p "Also delete app files at $APP_DEST? [y/N] " del_files
    if [[ "$del_files" =~ ^[Yy]$ ]]; then
      rm -rf "$APP_DEST"
      ok "App files deleted"
    fi

    read -r -p "Also delete env file at /etc/dvd-library/env? [y/N] " del_env
    if [[ "$del_env" =~ ^[Yy]$ ]]; then
      rm -rf /etc/dvd-library
      ok "Env file deleted"
    fi

    ok "Uninstall complete"
    ;;

  *)
    echo "Usage: sudo bash $0 {status|logs|update|uninstall}"
    exit 1
    ;;
esac
