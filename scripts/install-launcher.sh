#!/usr/bin/env bash
# Installs CP Gym as a desktop application for the current user (no sudo):
#   - an entry in the application menu, with its icon
#   - a launcher icon on the desktop
# Remove both with: npm run remove-launcher
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ENTRY="$APPS/cp-gym.desktop"
ICON="$DIR/assets/icon.png"

[ -f "$ICON" ] || { echo "Missing $ICON" >&2; exit 1; }
[ -x "$DIR/node_modules/electron/dist/electron" ] || { echo "Electron is not installed yet. Run: npm install" >&2; exit 1; }
chmod +x "$DIR/scripts/cp-gym.sh"
mkdir -p "$APPS"

# The file name and StartupWMClass match the app id the window reports ("desktopName" in package.json),
# so the dock and the window switcher show this icon for the running app.
cat > "$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=CP Gym
GenericName=Competitive programming trainer
Comment=Personal competitive programming gym
Exec="$DIR/scripts/cp-gym.sh"
Icon=$ICON
Terminal=false
Categories=Development;
Keywords=codeforces;competitive;programming;training;contest;
StartupWMClass=cp-gym
StartupNotify=true
EOF
chmod 644 "$ENTRY"
update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Application menu entry: $ENTRY"

DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESKTOP" ] && [ "$DESKTOP" != "$HOME" ]; then
  SHORTCUT="$DESKTOP/cp-gym.desktop"
  cp "$ENTRY" "$SHORTCUT"
  chmod +x "$SHORTCUT"
  # GNOME only launches desktop files it has been told to trust.
  gio set "$SHORTCUT" metadata::trusted true >/dev/null 2>&1 || true
  echo "Desktop icon: $SHORTCUT"
fi
