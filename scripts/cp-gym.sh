#!/usr/bin/env bash
# Starts CP Gym. Works from a terminal (npm start) and from the desktop launcher.
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
ELECTRON="$DIR/node_modules/electron/dist/electron"
SANDBOX="$DIR/node_modules/electron/dist/chrome-sandbox"

if [ ! -x "$ELECTRON" ]; then
  echo "Electron is not installed yet. Run: npm install" >&2
  exit 1
fi

FLAGS=()
# Ubuntu 23.10+ blocks Chromium's sandbox for apps without an AppArmor profile, unless the
# sandbox helper is owned by root (see: npm run enable-sandbox). Fall back to no sandbox so the app starts.
if ! { [ "$(stat -c '%u' "$SANDBOX" 2>/dev/null || echo 1)" = "0" ] && [ -u "$SANDBOX" ]; }; then
  restricted="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)"
  userns="$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)"
  if [ "$restricted" != "0" ] || [ "$userns" = "0" ]; then
    FLAGS+=(--no-sandbox)
    export CPGYM_SANDBOX=0
  fi
fi

exec "$ELECTRON" "$DIR" "${FLAGS[@]}" "$@"
