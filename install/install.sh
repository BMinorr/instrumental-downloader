#!/bin/bash
# Installer Mac - Instrumental Downloader.
# Se ruleaza cu Install-Mac.command sau direct din Terminal:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/BMinorr/instrumental-downloader/main/install/install.sh)"
# Poate fi rulat de cate ori vrei: instaleaza ce lipseste si aduce ultima versiune.
set -euo pipefail

REPO="${ID_REPO:-https://github.com/BMinorr/instrumental-downloader.git}"
INSTALL_DIR="${ID_DIR:-$HOME/InstrumentalDownloader}"
PORT=5177

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
fail() { printf '\n\033[31mEROARE: %s\033[0m\nPoti rula installer-ul din nou oricand - continua de unde a ramas.\n' "$1" >&2; exit 1; }

load_brew() {
  for brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$brew" ]; then eval "$("$brew" shellenv)"; return 0; fi
  done
  return 1
}

printf '\n\033[32mInstrumental Downloader - instalare\033[0m\nInstalez tot ce e nevoie. Dureaza cateva minute; nu inchide fereastra.\n'

step "1/5 Programele necesare (Homebrew, Git, Node.js, ffmpeg, yt-dlp)"
if ! load_brew; then
  echo "  Homebrew nu e instalat - il instalez (ti se poate cere parola Mac-ului)..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || fail "Instalarea Homebrew a esuat."
  load_brew || fail "Homebrew s-a instalat, dar nu il gasesc. Inchide Terminal-ul, deschide-l din nou si ruleaza installer-ul."
fi
# `git` de pe Mac e uneori doar un shim care cere Xcode Tools: verificam ca ruleaza cu adevarat.
git --version >/dev/null 2>&1 || brew install git
have node || brew install node
have ffmpeg || brew install ffmpeg
have yt-dlp || brew install yt-dlp
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 18 ] || brew upgrade node
echo "  Totul e instalat."

step "2/5 Descarc aplicatia in $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only || fail "Actualizarea aplicatiei (git pull) a esuat."
elif [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  fail "Folderul $INSTALL_DIR exista deja si nu e o instalare a aplicatiei. Muta-l sau sterge-l si ruleaza din nou."
else
  git clone "$REPO" "$INSTALL_DIR" || fail "Descarcarea aplicatiei (git clone) a esuat."
fi

step "3/5 Instalez dependentele serverului"
(cd "$INSTALL_DIR/server" && npm install --no-audit --no-fund) || fail "npm install a esuat."

step "4/5 Pornire automata a serverului la fiecare login"
if [ "${ID_SKIP_AUTOSTART:-}" = "1" ]; then
  echo "  (sarit)"
else
  bash "$INSTALL_DIR/autostart/mac/install.sh" || fail "Instalarea pornirii automate a esuat."
  healthy=""
  for _ in $(seq 1 20); do
    if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 1
  done
  if [ -n "$healthy" ]; then echo "  Serverul ruleaza."; else echo "  Serverul nu raspunde inca - repornirea Mac-ului il porneste."; fi
fi

step "5/5 Extensia din Chrome (singurul pas manual)"
EXTENSION_DIR="$INSTALL_DIR/extension"
if [ "${ID_NO_OPEN:-}" != "1" ]; then
  printf '%s' "$EXTENSION_DIR" | pbcopy
  open "$EXTENSION_DIR" || true
  open -a "Google Chrome" "chrome://extensions" 2>/dev/null || echo "  Deschide manual Chrome si scrie chrome://extensions in bara de adrese."
fi

printf '\n\033[32mAproape gata! In fereastra Chrome care s-a deschis:\033[0m\n'
echo "  1. Porneste 'Developer mode' (comutatorul din dreapta sus)"
echo "  2. Apasa 'Load unpacked'"
echo "  3. Alege folderul (calea e deja copiata: Cmd+Shift+G, apoi Cmd+V), apoi 'Select':"
printf '     \033[33m%s\033[0m\n' "$EXTENSION_DIR"
echo "  4. (optional) Apasa iconita de puzzle din Chrome si fixeaza extensia."
printf '\n\033[32mDupa asta, actualizarile se fac din extensie: Settings -> Updates.\033[0m\n'
