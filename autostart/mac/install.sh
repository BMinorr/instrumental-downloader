#!/bin/bash
# Instalează serverul ca serviciu de fundal (launchd) care pornește automat la login
# și se auto-repornește dacă vreodată se oprește neașteptat.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$PROJECT_DIR/server"
PLIST_LABEL="com.studio.instrumentaldownloader"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
NODE_PATH="$(command -v node)"

if [ -z "$NODE_PATH" ]; then
  echo "Nu găsesc 'node' în PATH. Instalează-l întâi (brew install node)." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$SERVER_DIR/server.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$SERVER_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <!-- Laptop-friendly: proces de fundal cu prioritate scăzută, nu ține Mac-ul treaz. -->
    <key>ProcessType</key>
    <string>Background</string>
    <key>Nice</key>
    <integer>5</integer>
    <key>LowPriorityIO</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$SERVER_DIR/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>$SERVER_DIR/launchd.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

echo "Instalat. Serverul pornește automat la fiecare login și rulează acum."
echo "Verifică: curl http://127.0.0.1:5177/health"
