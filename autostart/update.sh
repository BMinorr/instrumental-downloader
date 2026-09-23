#!/bin/bash
# Aduce ultimele modificări din Git, actualizează dependențele și repornește serverul (Mac).
# După rulare: în chrome://extensions apasă ↻ pe extensie dacă s-a schimbat ceva în extension/.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_LABEL="com.studio.instrumentaldownloader"

cd "$PROJECT_DIR"
git pull --ff-only

(cd server && npm install --no-audit --no-fund)

if launchctl print "gui/$(id -u)/$PLIST_LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"
  echo "Server repornit."
else
  echo "Serviciul de auto-start nu e instalat — rulează ./autostart/mac/install.sh sau pornește manual (cd server && npm start)."
fi

echo "Gata. Dacă s-a schimbat ceva în extension/, apasă ↻ pe extensie în chrome://extensions."
