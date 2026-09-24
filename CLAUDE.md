# Studio Instrumental Downloader — context pentru Claude

Proiect al unui proprietar de studio de muzică: extensie Chrome + server local Node.js, folosite ca să descarce instrumentalele trimise de clienți. Se dezvoltă pe un Mac (acasă) și rulează pe un PC Windows (studio) — **același cod pe ambele**, sincronizat prin Git.

## Cum lucrezi cu utilizatorul

- Comunică în **română**. Textul din UI-ul extensiei e în **engleză** (decizie explicită).
- Utilizatorul testează fiecare modificare live, în Chrome real, și raportează rezultate concrete. Investighează cauza reală a bug-urilor, nu ghici; verifică empiric înainte să spui că ceva merge.
- Paritate Mac/Windows: orice funcționalitate/script trebuie să meargă pe ambele. Dacă adaugi ceva specific unui OS, adaugă și echivalentul pentru celălalt.
- La finalul unei modificări: rezumat scurt (ce s-a făcut + cum a fost testat) și „Reîncarcă extensia (↻) în `chrome://extensions`" dacă s-a schimbat ceva în `extension/`.

## Arhitectură

- `extension/` — Chrome Manifest V3. `popup.*` (tab-uri: File, Link, Sample, Settings; Link e implicit la prima deschidere, apoi se ține minte ultimul tab), `background.js` (service worker: descărcări, Tunebat, coordonare Sample), `offscreen.*` (înregistrarea audio din tab, supraviețuiește închiderii popup-ului).
- `server/` — Express pe `127.0.0.1:5177`, apelează `yt-dlp` și `ffmpeg` cu `spawn` și array de argumente (niciodată concatenare de string → fără command injection).
  - `POST /api/analyze`, `POST /api/download` (`{url, format, loudnorm}`), `POST /api/spotify-resolve`, `POST /api/upload-convert` (bytes bruți + query `format`, `trimStart`, `trimEnd`, `loudnorm`), `POST /api/stash?ext=` (fișier local din tab-ul File, servit înapoi ca-atare pentru Tunebat), `GET /files/:name`, `GET /health`.
  - `lib/ytdlp.js` (logică comună), `youtube.js`, `instagram.js`, `spotify.js`.
- `autostart/` — pornire automată la login: `mac/` (launchd), `windows/` (Task Scheduler + wrapper `.vbs` ascuns). `update.sh` / `update.ps1` fac `git pull` + `npm install` + repornesc serverul.

## Decizii luate (nu le reface fără să întrebi)

- **BPM/Key detection eliminat** (rezultate inconsistente cu algoritmi de corelație). În loc: după ce un fișier e *efectiv* descărcat, apare butonul „Analyze BPM & Key on Tunebat" care deschide `tunebat.com/Analyzer` și inserează automat fișierul.
- **Inserarea în Tunebat**: `chrome.scripting.executeScript` acceptă doar argumente JSON-serializabile (ArrayBuffer devine `{}`) → fișierul se trimite ca **base64**; injecția rulează în **`world: "MAIN"`** (altfel `File`/`DataTransfer` sunt dintr-un alt realm și React-ul Tunebat le respinge). Așteptarea încărcării tab-ului are timeout de 15s.
- **Spotify**: fără DRM-circumvention. Se citesc titlul/artistul de pe pagină și se caută pe YouTube (`ytsearch1:`). Potrivirea e automată, deci UI-ul arată titlul găsit.
- **Instagram**: `--cookies-from-browser chrome` (sesiunea deja logată în Chrome pe acel PC).
- **Sample (tab capture)**: `chrome.tabCapture` + offscreen document + `MediaRecorder` (webm/opus). Blob-ul rămâne în memoria offscreen document-ului, **nu** în `chrome.storage.session` (limită 10MB). Popup-ul cere înregistrarea înapoi doar la nevoie (`sample:getLast`). Ultimul tab activ (Link/Sample/Settings) se ține minte în `chrome.storage.local`.
- **Tab-ul File**: dropzone + file picker; formate limitate la ce acceptă Tunebat (mp3/wav/flac/aac/ogg/m4a), max 100MB. Fișierul urcă pe server (`/api/stash`) abia la click pe Tunebat, apoi `background.js` îl ia prin URL — același drum ca piesele descărcate (popup-ul se închide când se deschide tab-ul Tunebat, deci nu poate transmite bytes direct). Butonul Tunebat din File e ascuns până e ales un fișier. **De verificat pe Mac/Windows real**: Chrome poate închide popup-ul când se deschide dialogul de fișiere sau când tragi un fișier din alt fereastră; dacă se întâmplă, soluția e o fereastră detașată (`chrome.windows.create`), nu popup.
- **Viteza (măsurată, nu presupusă)**: (1) `launchd` cu `ProcessType=Background`/`Nice` încetinea de 3-4× yt-dlp/ffmpeg (copiii moștenesc prioritatea; și `Adaptive` dă tot prioritate minimă) → acum `Interactive`, iar pe Windows `-Priority 4` la Task Scheduler (implicit 7 = below normal). NU reintroduce Background/Nice/LowPriorityIO. (2) Extragerea yt-dlp (~3s) e partea lentă, descărcarea <1s → analiza salvează `<id>.info.json`, descărcarea folosește `--load-info-json`. (3) După `/api/analyze`, serverul rulează `prepare()` (sursă + MP3 + WAV în fundal); cererile suprapuse partajează joburile (`dedupe`). (4) Volumul: `loudnorm` costa ~6s → `ebur128` (măsurare) + `volume` + `alimiter` (-16 LUFS, vârf ≤ -1,5 dBFS), la fel ca rezultat. (5) Popup YouTube: titlul din `tab.title`, thumbnail din `i.ytimg.com/vi/<id>/mqdefault.jpg`, butoane active instant; analiza completează doar meta.
- **Tunebat**: Tunebat e SPA (fără input în HTML-ul brut) → `background.js` verifică la 100ms (`tunebatUploadReady`: input + cheie `__reactProps$`, fallback `readyState==="complete"`) și injectează imediat, fără așteptarea `load`/1s fixă. Erorile după deschiderea tab-ului apar ca toast pe pagina Tunebat (popup-ul e deja închis).
- **Cache server**: ffmpeg scrie întâi în `<id>.partial.<ext>` și face rename la final (un fișier trunchiat nu mai ajunge „cache hit"); sursele yt-dlp se recunosc doar după extensie finală (nu `.part`); cererile identice simultane partajează același job (`dedupe` în `ytdlp.js`).
- **Trim** pe waveform: `-ss`/`-to` puse **după** `-i` (folosesc timeline-ul absolut al sursei — verificat empiric).
- **Loudnorm** (`loudnorm=I=-16:TP=-1.5:LRA=11`) e implicit ON, cu toggle în Settings (`chrome.storage.local["settings.loudnorm"]`). Fișierul cache pentru varianta fără normalizare are sufixul `-raw`; sursa brută e partajată între ambele variante.
- **Tab-ul Settings** stă în dreapta, iar bulina de status a serverului rămâne cel mai în dreapta element din header.
- Fișierele din `server/downloads/` se șterg automat după 1 oră.

## Comenzi utile

```bash
cd server && npm install && npm start          # pornire manuală a serverului
curl http://127.0.0.1:5177/health              # -> {"ok":true}
./autostart/update.sh                          # Mac: pull + npm install + restart server
.\autostart\update.ps1                         # Windows (PowerShell): idem
```

Pe Mac serverul rulează ca LaunchAgent `com.studio.instrumentaldownloader` (repornire: `launchctl kickstart -k "gui/$(id -u)/com.studio.instrumentaldownloader"`). Pe Windows ca Scheduled Task `InstrumentalDownloaderServer`.

## Idei propuse, neimplementate (utilizatorul nu le-a ales încă)

Auto-trim al liniștii, „re-record" rapid, descărcare MP3+WAV simultan, format preferat ținut minte, notificare desktop la final.
