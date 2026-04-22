#!/usr/bin/env bash
# =============================================================================
# install-service.sh  —  DVD Library service installer
#
# Supports Node.js 18/20/22/24 and MySQL 5.7+ / MariaDB 10.4+
# Enables auto-start on reboot via systemd.
#
# Usage (must run as root):
#   sudo bash systemd/install-service.sh [OPTIONS]
#
# Options:
#   --app-dir /path   Source directory (default: parent of this script)
#   --dest    /path   Install destination (default: /opt/dvd-library)
#   --user    name    System user to run the service (default: dvdlib)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fatal() { echo -e "${RED}[FAIL]${RESET}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}── $* ──${RESET}"; }

[[ $EUID -ne 0 ]] && fatal "Run as root:  sudo bash $0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DEST="/opt/dvd-library"
APP_USER="dvdlib"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) APP_SRC="$2";  shift 2 ;;
    --dest)    APP_DEST="$2"; shift 2 ;;
    --user)    APP_USER="$2"; shift 2 ;;
    *) fatal "Unknown option: $1" ;;
  esac
done

SERVICE_NAME="dvd-library"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_DIR="/etc/dvd-library"
ENV_FILE="${ENV_DIR}/env"
POSTER_DIR="${APP_DEST}/frontend/posters"

echo ""
echo -e "${BOLD}🎬  DVD Library — Service Installer${RESET}"
printf   "    Source  : %s\n" "$APP_SRC"
printf   "    Install : %s\n" "$APP_DEST"
printf   "    User    : %s\n" "$APP_USER"
echo ""

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────
step "1/9  Checking prerequisites"

command -v node >/dev/null 2>&1 || fatal "Node.js not found.
  Install Node.js 24 LTS (recommended):
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt install -y nodejs"

NODE_VER=$(node -e "process.stdout.write(process.version)")
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[[ "$NODE_MAJOR" -lt 18 ]] && fatal "Node.js v18+ required (found $NODE_VER). Install v24 LTS."
ok "Node.js $NODE_VER"

command -v npm >/dev/null 2>&1 || fatal "npm not found"
ok "npm $(npm --version)"

# Check MySQL/MariaDB is reachable
DB_CMD=""
command -v mariadb >/dev/null 2>&1 && DB_CMD="mariadb"
command -v mysql   >/dev/null 2>&1 && DB_CMD="mysql"
[[ -n "$DB_CMD" ]] && ok "DB client: $DB_CMD" || \
  warn "mysql/mariadb client not in PATH — install: sudo apt install -y mariadb-server"

command -v rsync >/dev/null 2>&1 || apt-get install -y rsync -qq

# ── Step 2: System user ───────────────────────────────────────────────────────
step "2/9  System user"
if id "$APP_USER" &>/dev/null; then
  ok "User '$APP_USER' already exists"
else
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  ok "User '$APP_USER' created (locked, no login)"
fi

# ── Step 3: Copy files ────────────────────────────────────────────────────────
step "3/9  Copying application files"
mkdir -p "$APP_DEST"
rsync -a --delete \
  --exclude='.env' --exclude='node_modules' --exclude='frontend/posters' \
  --exclude='.git'  --exclude='db_data'     --exclude='*.log' \
  "$APP_SRC/" "$APP_DEST/"
ok "Files copied"

# ── Step 4: npm install ───────────────────────────────────────────────────────
step "4/9  Installing Node.js dependencies"
cd "$APP_DEST/backend"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --silent
else
  npm install --omit=dev --silent
fi
ok "Dependencies installed (production)"
cd - >/dev/null

# ── Step 5: Posters dir ───────────────────────────────────────────────────────
step "5/9  Poster cache directory"
mkdir -p "$POSTER_DIR"
chown -R "$APP_USER:$APP_USER" "$POSTER_DIR"
ok "$POSTER_DIR"

# ── Step 6: Environment file ──────────────────────────────────────────────────
step "6/9  Environment file"
mkdir -p "$ENV_DIR"
chmod 750 "$ENV_DIR"

if [[ -f "$ENV_FILE" ]]; then
  warn "Existing $ENV_FILE kept (not overwritten)"
else
  for src in "$APP_SRC/.env" "$APP_SRC/backend/.env" "$APP_DEST/backend/.env.example"; do
    if [[ -f "$src" ]]; then
      cp "$src" "$ENV_FILE"
      ok "Copied $(basename "$src") → $ENV_FILE"
      break
    fi
  done
fi
chmod 640 "$ENV_FILE"
chown root:"$APP_USER" "$ENV_FILE"

ENV_READY=true
if grep -qE 'your_|changeme_|_secret$|_here$' "$ENV_FILE" 2>/dev/null; then
  ENV_READY=false
  warn "────────────────────────────────────────────────────────────"
  warn " Env file has placeholder values — edit before starting:"
  warn "   sudo nano $ENV_FILE"
  warn " Required: DB_PASS, SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET"
  warn " Generate SESSION_SECRET:"
  warn "   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  warn "────────────────────────────────────────────────────────────"
fi

# ── Step 7: Permissions ───────────────────────────────────────────────────────
step "7/9  File permissions"
chown -R root:"$APP_USER" "$APP_DEST"
chmod -R o-rwx "$APP_DEST"
chmod -R g+rX  "$APP_DEST"
chown -R "$APP_USER:$APP_USER" "$POSTER_DIR"
chmod +x "$APP_DEST/systemd/"*.sh 2>/dev/null || true
ok "root:$APP_USER, world-inaccessible"

# ── Step 8: systemd unit ──────────────────────────────────────────────────────
step "8/9  Installing systemd unit"
NODE_BIN="$(command -v node)"
sed \
  -e "s|WorkingDirectory=.*|WorkingDirectory=${APP_DEST}/backend|" \
  -e "s|ExecStart=.*|ExecStart=${NODE_BIN} ${APP_DEST}/backend/server.js|" \
  -e "s|ReadWritePaths=.*|ReadWritePaths=${POSTER_DIR}|" \
  -e "s|^User=.*|User=${APP_USER}|" \
  -e "s|^Group=.*|Group=${APP_USER}|" \
  "$APP_DEST/systemd/dvd-library.service" > "$SERVICE_FILE"
chmod 644 "$SERVICE_FILE"
ok "$SERVICE_FILE"

# ── Step 9: Enable + start ────────────────────────────────────────────────────
step "9/9  Enabling service (auto-start on reboot)"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
ok "Enabled — will start automatically on reboot"

if [[ "$ENV_READY" == "true" ]]; then
  systemctl start "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Service started ✓"
  else
    warn "Service may have failed. Check: journalctl -u $SERVICE_NAME -n 50 --no-pager"
  fi
else
  warn "Service NOT started — edit $ENV_FILE first, then:"
  warn "  sudo systemctl start $SERVICE_NAME"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
PORT=$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo 3000)
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
echo ""
echo -e "${BOLD}${GREEN}Installation complete!${RESET}"
echo ""
printf "  App      : %s\n"  "$APP_DEST"
printf "  Env      : %s\n"  "$ENV_FILE"
printf "  URL      : http://%s:%s\n" "${HOST_IP}" "${PORT:-3000}"
echo ""
echo "  Service commands:"
echo "    sudo systemctl start   $SERVICE_NAME"
echo "    sudo systemctl stop    $SERVICE_NAME"
echo "    sudo systemctl restart $SERVICE_NAME"
echo "    sudo systemctl status  $SERVICE_NAME"
echo "    sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo "  Update app after pulling new code:"
echo "    sudo bash $APP_DEST/systemd/manage-service.sh update"
echo ""
