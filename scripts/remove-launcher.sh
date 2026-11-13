#!/usr/bin/env bash
# Removes the application menu entry and the desktop icon created by install-launcher.sh.
set -euo pipefail
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
rm -f "$APPS/cp-gym.desktop" "$DESKTOP/cp-gym.desktop"
update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Removed the CP Gym launcher and desktop icon. Your training data is untouched."
