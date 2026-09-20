#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Photobooth AI — one-time privileged bootstrap for the canonical VPS paths.
#
# WHY THIS EXISTS
#   skills/docker-vps/SKILL.md section 2 fixes the project boundary at:
#       application files : /opt/photobooth
#       runtime files     : /srv/photobooth
#   Both parents (/opt, /srv) are owned by root, and the deploy user `mahez`
#   has no passwordless sudo. Creating them therefore requires ONE privileged
#   invocation, which only a human operator can perform.
#
# WHAT IT DOES (and nothing else)
#   - creates /opt/photobooth
#   - creates /srv/photobooth/{templates,tmp,cache,backups,uploads,results}
#   - chowns both trees to the deploy user so the unprivileged agent can work
#
# SAFETY (spec sections 7 + 8, skill docker-vps sections 2/8/9)
#   - ONLY touches /opt/photobooth and /srv/photobooth. No other path.
#   - idempotent: safe to run repeatedly.
#   - NEVER deletes anything. NEVER runs docker system prune.
#   - NEVER touches containers, networks, volumes, firewall, SSH or the
#     reverse proxy.
#
# USAGE (run as a human with sudo):
#       sudo bash /home/mahez/photoboothai/scripts/bootstrap_vps.sh
#
# ROLLBACK
#       sudo rm -rf /opt/photobooth /srv/photobooth
#   (safe only while these trees hold no production data)
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="/opt/photobooth"
RUNTIME_DIR="/srv/photobooth"
DEPLOY_USER="${DEPLOY_USER:-mahez}"
DEPLOY_GROUP="${DEPLOY_GROUP:-mahez}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: this script must be run as root (sudo bash $0)" >&2
  exit 1
fi

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "ERROR: deploy user '$DEPLOY_USER' does not exist. Pass DEPLOY_USER=... " >&2
  exit 1
fi

echo "== Photobooth AI privileged bootstrap =="
echo "   app dir     : $APP_DIR"
echo "   runtime dir : $RUNTIME_DIR"
echo "   owner       : $DEPLOY_USER:$DEPLOY_GROUP"
echo

# --- application directory -------------------------------------------------
mkdir -p "$APP_DIR"
echo "[ok] $APP_DIR"

# --- runtime directories (spec section 6) ----------------------------------
for sub in templates tmp cache backups uploads results; do
  mkdir -p "$RUNTIME_DIR/$sub"
  echo "[ok] $RUNTIME_DIR/$sub"
done

# Loose files in the runtime root (e.g. processing scratch) also need to be
# writable by the application user.
chmod 0755 "$RUNTIME_DIR"

# --- ownership -------------------------------------------------------------
# The containers run as an internal `photobooth` user, but host-side tooling
# (backups, inspection, the agent) runs as $DEPLOY_USER. Give the deploy user
# ownership so no further privileged steps are needed day to day.
chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$RUNTIME_DIR"

echo
echo "== Result =="
ls -ld "$APP_DIR" "$RUNTIME_DIR"
ls -l  "$RUNTIME_DIR"
echo
echo "Bootstrap complete. Next (unprivileged):"
echo "  bash $APP_DIR/scripts/migrate_to_opt.sh    # if migrating an existing checkout"
echo "  cd $APP_DIR && docker compose config && docker compose up -d"
