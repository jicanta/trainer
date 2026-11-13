#!/usr/bin/env bash
# One-time, optional: lets Chromium's sandbox work on Ubuntu 23.10+ by making its helper root-owned.
# Needs sudo. Re-run after "npm install" replaces Electron.
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
SANDBOX="$DIR/node_modules/electron/dist/chrome-sandbox"
sudo chown root:root "$SANDBOX"
sudo chmod 4755 "$SANDBOX"
echo "Sandbox helper configured. CP Gym now starts with the Chromium sandbox on."
