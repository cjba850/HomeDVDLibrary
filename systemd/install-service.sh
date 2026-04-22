#!/usr/bin/env bash
# =============================================================================
# install-service.sh
# Installs the DVD Library as a systemd service on a Linux host.
#
# Usage (run as root or with sudo):
#   sudo bash systemd/install-service.sh [--app-dir /path/to/project]
#
# What it does:
#   1. Creates a dedicated 'dvdlib' system user
#   2. Copies the project to /opt/dvd-library
#   3. Installs Node.js dependencies (production only)
#   4. Creates /etc/dvd-library/env from your .env file
#   5. Installs and enables the systemd unit
#   6. Creates the posters cache directory
#   7. Starts the service
# =============================================================================
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fatal() { echo -e "${RED}[FAIL]${RESET}  $*" >&2; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && fatal "This script must be run as root: sudo bash $0"

# ── Detect project root (one level up from this script) ───────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SRC="$(cd "$SCRIPT_DIR/.." && pwd)"

# Allow override via --app-dir flag
APP_SRC="$DEFAULT_SRC"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) APP_SRC="$2"; shift 2 ;;
    *) shift ;;
  esac
done

APP_DEST="/opt/dvd-library"
SERVICE_NAME="dvd-library"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_DIR="/etc/dvd-library"
ENV_FILE="${ENV_DIR}/env"
APP_USER="dvdlib"
POSTER_DIR="${APP_DEST}/frontend/posters"

echo ""
echo -e "${BOLD}🎬  DVD Library — Service Installer${RESET}"
echo "    Source : $APP_SRC"
echo "    Install: $APP_DEST"
echo "    Service: $SERVICE_FILE"
echo ""

# ── 1. Check prerequisites ────────────────────────────────────────────────────
info "Checking prerequisites…"
command -v node  >/dev/null 2>&1 || fatal "Node.js not found. Install: https://nodejs.org or use nvm"
command -v npm   >/dev/null 2>&1 || fatal "npm not found."
NODE_VER=$(node -e "process.stdout.write(process.version)")
info "  Node.js: $NODE_VER"

# ── 2. Create system user ─────────────────────────────────────────────────────
if id "$APP_USER" &>/dev/null; then
  ok "User '$APP_USER' already exists"
else
  info "Creating system user '$APP_USER'…"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  ok "User '$APP_USER' created"
fi

# ── 3. Copy application files ─────────────────────────────────────────────────
info "Copying application to $APP_DEST…"
mkdir -p "$APP_DEST"
rsync -a --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='frontend/posters' \
  --exclude='.git' \
  --exclude='db_data' \
  "$APP_SRC/" "$APP_DEST/"
ok "Files copied"

# ── 4. Install Node dependencies ──────────────────────────────────────────────
info "Installing Node.js dependencies (production)…"
cd "$APP_DEST/backend"
npm ci --omit=dev --silent
ok "Dependencies installed"
cd "$SCRIPT_DIR"

# ── 5. Create posters directory ───────────────────────────────────────────────
info "Creating posters cache directory…"
mkdir -p "$POSTER_DIR"
chown -R "$APP_USER:$APP_USER" "$POSTER_DIR"
ok "Posters dir: $POSTER_DIR"

# ── 6. Set up environment file ────────────────────────────────────────────────
mkdir -p "$ENV_DIR"
chmod 750 "$ENV_DIR"

if [[ -f "$ENV_FILE" ]]; then
  warn "Environment file already exists at $ENV_FILE — skipping (edit manually to update)"
else
  # Try to copy from project .env; fall back to .env.example
  if [[ -f "$APP_SRC/backend/.env" ]]; then
    cp "$APP_SRC/backend/.env" "$ENV_FILE"
    ok "Copied $APP_SRC/backend/.env → $ENV_FILE"
  elif [[ -f "$APP_SRC/.env" ]]; then
    cp "$APP_SRC/.env" "$ENV_FILE"
    ok "Copied $APP_SRC/.env → $ENV_FILE"
  else
    cp "$APP_DEST/backend/.env.example" "$ENV_FILE"
    warn "No .env found — copied .env.example to $ENV_FILE"
    warn "⚠  EDIT $ENV_FILE before starting the service!"
  fi
fi

chmod 640 "$ENV_FILE"
chown root:"$APP_USER" "$ENV_FILE"

# ── 7. Set ownership ──────────────────────────────────────────────────────────
info "Setting file ownership…"
chown -R root:"$APP_USER" "$APP_DEST"
chmod -R o-rwx "$APP_DEST"
# posters dir needs write access for the app user
chown -R "$APP_USER:$APP_USER" "$POSTER_DIR"
ok "Ownership set"

# ── 8. Install systemd unit ───────────────────────────────────────────────────
info "Installing systemd service…"

# Patch the service file with actual install path
sed \
  -e "s|WorkingDirectory=.*|WorkingDirectory=${APP_DEST}/backend|" \
  -e "s|ExecStart=.*|ExecStart=$(command -v node) ${APP_DEST}/backend/server.js|" \
  -e "s|ReadWritePaths=.*|ReadWritePaths=${POSTER_DIR}|" \
  "$APP_SRC/systemd/dvd-library.service" > "$SERVICE_FILE"

chmod 644 "$SERVICE_FILE"
ok "Service file written: $SERVICE_FILE"

# ── 9. Enable and start ───────────────────────────────────────────────────────
info "Reloading systemd daemon…"
systemctl daemon-reload

info "Enabling $SERVICE_NAME to start on boot…"
systemctl enable "$SERVICE_NAME"

# Check if env file has been customised enough to try starting
if grep -q "your_omdb_key_here\|changeme_root\|dvdlib_secret" "$ENV_FILE" 2>/dev/null; then
  echo ""
  warn "──────────────────────────────────────────────────────"
  warn " The environment file still contains placeholder values."
  warn " Edit $ENV_FILE with your real DB password and OMDB key,"
  warn " then run:  sudo systemctl start $SERVICE_NAME"
  warn "──────────────────────────────────────────────────────"
else
  info "Starting $SERVICE_NAME…"
  systemctl start "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Service is running ✓"
  else
    warn "Service may have failed to start. Check logs:"
    warn "  journalctl -u $SERVICE_NAME -n 30 --no-pager"
  fi
fi

# ── 10. Summary ───────────────────────────────────────────────────────────────
PORT=$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo 3000)
echo ""
echo -e "${BOLD}${GREEN}Installation complete!${RESET}"
echo ""
echo "  App directory : $APP_DEST"
echo "  Env file      : $ENV_FILE"
echo "  Posters cache : $POSTER_DIR"
echo "  Service       : $SERVICE_NAME"
echo "  URL           : http://$(hostname -I | awk '{print $1}'):${PORT:-3000}"
echo ""
echo "  Useful commands:"
echo "    sudo systemctl status  $SERVICE_NAME"
echo "    sudo systemctl restart $SERVICE_NAME"
echo "    sudo systemctl stop    $SERVICE_NAME"
echo "    sudo journalctl -u $SERVICE_NAME -f        # live logs"
echo ""
echo "  Fetch poster images for existing records:"
echo "    cd $APP_DEST && node scripts/fetch-posters.js"
echo ""
