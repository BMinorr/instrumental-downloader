#!/bin/bash
# Oprește și dezinstalează pornirea automată a serverului la login.
set -euo pipefail

PLIST_LABEL="com.studio.instrumentaldownloader"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "Dezinstalat. Serverul nu mai pornește automat la login."
echo "Poți în continuare să-l pornești manual cu: cd server && npm start"
