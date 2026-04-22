#!/usr/bin/env bash
# =============================================================================
# manage-service.sh  —  start | stop | restart | status | logs | update | uninstall
#
# Usage:
#   sudo bash systemd/manage-service.sh <action>
#
# Actions:
#   start      Start the service
#   stop       Stop the service
#   restart    Restart the service
#   status     Show service status
#   logs       Tail live logs (Ctrl+C to exit)
#   update     Sync new files from source, reinstall deps, restart
#   uninstall  Stop, disable, and optionally remove all files
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fatal() { echo -e "${RED}[FAIL]${RESET}  $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && fatal "Run as root:  sudo bash $0 $*"

SERVICE_NAME="dvd-library"
APP_DEST="/opt/dvd-library"
APP_USER="dvdlib"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CMD="${1:-status}"

case "$CMD" in

  # ── Start ────────────────────────────────────────────────────────────────
  start)
    info "Starting $SERVICE_NAME…"
    systemctl start "$SERVICE_NAME"
    sleep 1
    systemctl is-active --quiet "$SERVICE_NAME" \
      && ok "Service is running" \
      || warn "Service may have failed — check: journalctl -u $SERVICE_NAME -n 30"
    ;;

  # ── Stop ─────────────────────────────────────────────────────────────────
  stop)
    info "Stopping $SERVICE_NAME…"
    systemctl stop "$SERVICE_NAME"
    ok "Service stopped"
    ;;

  # ── Restart ──────────────────────────────────────────────────────────────
  restart)
    info "Restarting $SERVICE_NAME…"
    systemctl restart "$SERVICE_NAME"
    sleep 1
    systemctl is-active --quiet "$SERVICE_NAME" \
      && ok "Service restarted" \
      || warn "Service may have failed — check: journalctl -u $SERVICE_NAME -n 30"
    ;;

  # ── Status ───────────────────────────────────────────────────────────────
  status)
    systemctl status "$SERVICE_NAME" --no-pager -l
    ;;

  # ── Logs ─────────────────────────────────────────────────────────────────
  logs)
    echo -e "${CYAN}Following logs for $SERVICE_NAME — Ctrl+C to exit${RESET}"
    journalctl -u "$SERVICE_NAME" -f --no-pager
    ;;

  # ── Update ───────────────────────────────────────────────────────────────
  update)
    info "Syncing files from $SRC_DIR → $APP_DEST…"
    rsync -a --delete \
      --exclude='.env' --exclude='node_modules' --exclude='frontend/posters' \
      --exclude='.git'  --exclude='db_data'     --exclude='*.log' \
      "$SRC_DIR/" "$APP_DEST/"
    ok "Files synced"

    info "Updating Node.js dependencies…"
    cd "$APP_DEST/backend"
    if [[ -f package-lock.json ]]; then
      npm ci --omit=dev --silent
    else
      npm install --omit=dev --silent
    fi
    ok "Dependencies updated"
    cd - >/dev/null

    # Fix ownership after sync
    chown -R root:"$APP_USER" "$APP_DEST"
    chmod -R o-rwx "$APP_DEST"
    chown -R "$APP_USER:$APP_USER" "$APP_DEST/frontend/posters" 2>/dev/null || true

    info "Reloading systemd and restarting service…"
    systemctl daemon-reload
    systemctl restart "$SERVICE_NAME"
    sleep 2
    systemctl is-active --quiet "$SERVICE_NAME" \
      && ok "Service restarted successfully ✓" \
      || warn "Check logs: journalctl -u $SERVICE_NAME -n 50 --no-pager"
    ;;

  # ── Uninstall ────────────────────────────────────────────────────────────
  uninstall)
    warn "This will stop and remove the $SERVICE_NAME service."
    read -r -p "Continue? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }

    systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    ok "Service removed"

    read -r -p "Delete app files at $APP_DEST? [y/N] " del_app
    [[ "$del_app" =~ ^[Yy]$ ]] && { rm -rf "$APP_DEST"; ok "App files deleted"; }

    read -r -p "Delete env file at /etc/dvd-library/env? [y/N] " del_env
    [[ "$del_env" =~ ^[Yy]$ ]] && { rm -rf /etc/dvd-library; ok "Env file deleted"; }

    ok "Uninstall complete"
    ;;

  *)
    echo ""
    echo -e "${BOLD}Usage: sudo bash $0 <action>${RESET}"
    echo ""
    echo "  start      Start the service"
    echo "  stop       Stop the service"
    echo "  restart    Restart the service"
    echo "  status     Show service status"
    echo "  logs       Tail live logs"
    echo "  update     Sync new code and restart"
    echo "  uninstall  Remove service and optionally all files"
    echo ""
    exit 1
    ;;
esac
