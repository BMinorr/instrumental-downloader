#!/bin/bash
# Dublu-click (sau: click dreapta -> Open la prima rulare). Descarca si ruleaza installer-ul.
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BMinorr/instrumental-downloader/main/install/install.sh)"
echo
read -n 1 -s -r -p "Apasa orice tasta pentru a inchide..."
