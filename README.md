# Studio Instrumental Downloader

Extensie Chrome + server local pentru descărcarea instrumentalelor pe care ți le trimit clienții.

**Faza 1 (gata):** YouTube → MP3 320kbps sau WAV.
**Faza 2 (gata):** Spotify — caută automat echivalentul pe YouTube și descarcă de-acolo (vezi nota despre DRM mai jos).
**Faza 3 (gata):** Instagram — Story, Reel și Post, cu autentificare din Chrome (vezi mai jos).
**Faza 4 (gata):** tab „Sample" — înregistrează audio-ul care redă din tab-ul curent (ex. un beat pe care clientul ți-l cântă live într-un apel video), apoi descarcă-l ca MP3 320kbps sau WAV.

Extensia are trei tab-uri principale: **File** (alegi/tragi un fișier audio local, îl convertești în alt format sau îl trimiți în Tunebat), **Link** (fluxul YouTube/Spotify/Instagram de mai sus — tab-ul implicit) și **Sample** (înregistrare directă din tab), plus **Settings**. Detecția de BPM/Key nu mai e integrată în extensie (rezultate inconsistente) — în schimb, după ce o piesă e efectiv descărcată, apare un buton **„Analyze BPM & Key on Tunebat"** care deschide [tunebat.com/Analyzer](https://tunebat.com/Analyzer) într-un tab nou cu **fișierul deja inserat automat** acolo.

## De ce ai nevoie de un server local

YouTube nu permite extragerea audio doar din extensia de browser (stream-urile sunt protejate/adaptive). Soluția standard e ca extensia să trimită link-ul către un mic server care rulează pe calculatorul tău din studio, care face descărcarea/conversia cu `yt-dlp` + `ffmpeg`. De aceea trebuie să pornești serverul înainte să folosești extensia.

Serverul pornește **automat la login** (pe Mac și pe Windows) și rulează în fundal — nu trebuie să deschizi Terminal de fiecare dată. Consum măsurat la inactivitate: ~0% CPU, ~25-50MB RAM, deci nu afectează vizibil bateria laptopului. Procesul de utilizare zilnică (deschide YouTube → click extensie → alege format) e **identic pe Mac și pe Windows**.

## 1. Instalare (o singură dată)

### Pe Mac (acasă / testare)

Deschide Terminal și rulează pe rând:

```bash
# Homebrew (dacă nu-l ai deja) - vezi și https://brew.sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

```bash
brew install node yt-dlp ffmpeg
```

### Pe Windows (studio)

Deschide **PowerShell** (nu trebuie Admin) și rulează pe rând — `winget` vine deja instalat pe Windows 10/11:

```powershell
winget install OpenJS.NodeJS.LTS
```

```powershell
winget install yt-dlp.yt-dlp
```

```powershell
winget install Gyan.FFmpeg
```

Închide și redeschide PowerShell după instalare (ca să se actualizeze PATH-ul), apoi verifică:

```powershell
node --version
yt-dlp --version
ffmpeg -version
```

### Apoi, pe ambele sisteme — dependențele serverului

```bash
cd server
npm install
```

## 2. Pornirea automată a serverului (o singură dată)

### Pe Mac

```bash
chmod +x autostart/mac/install.sh
./autostart/mac/install.sh
```

### Pe Windows

Deschide PowerShell **ca Administrator** în folderul `autostart/windows` și rulează:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install.ps1
```

Gata — de acum serverul pornește singur la fiecare login și rulează tot timpul cât ești logat, fără să mai deschizi Terminal/PowerShell. Testează oricând că e activ: [http://127.0.0.1:5177/health](http://127.0.0.1:5177/health) ar trebui să arate `{"ok":true}`.

### Control manual (opțional, dacă vrei să-l oprești/repornești)

**Mac:**
```bash
launchctl bootout gui/$(id -u)/com.studio.instrumentaldownloader   # oprește
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.studio.instrumentaldownloader.plist   # pornește
launchctl kickstart -k gui/$(id -u)/com.studio.instrumentaldownloader   # repornește
./autostart/mac/uninstall.sh   # elimină pornirea automată definitiv
```

**Windows (PowerShell):**
```powershell
Stop-ScheduledTask -TaskName InstrumentalDownloaderServer      # oprește task-ul (nu și procesul deja pornit — vezi uninstall.ps1)
Start-ScheduledTask -TaskName InstrumentalDownloaderServer     # pornește
.\autostart\windows\uninstall.ps1                              # elimină pornirea automată definitiv
```

### Alternativ: pornire manuală (dacă nu vrei auto-start)

```bash
cd server
npm start
```

## 3. Instalarea extensiei în Chrome (o singură dată)

1. Deschide `chrome://extensions`
2. Activează **Developer mode** (colț dreapta sus)
3. Click **Load unpacked** și selectează folderul `extension/`
4. Extensia apare în bara de unelte, cu icon-ul ei propriu (nu mai e puzzle piece generic) → pin-eaz-o

## 4. Utilizare

1. Deschide un videoclip YouTube (instrumentalul trimis de client)
2. Click pe iconița extensiei
3. Alege **MP3** sau **WAV** — fișierul apare în Downloads-urile Chrome
4. După ce descărcarea chiar se termină (nu doar la click), apare butonul **„Analyze BPM & Key on Tunebat"** — click pe el deschide Tunebat într-un tab nou cu piesa deja încărcată acolo, gata de analiză

(Serverul rulează deja automat în fundal — vezi pasul 2 de mai sus.)

## Cum funcționează inserarea automată în Tunebat

Tunebat analizează fișierele **local, în browser** (nu le trimite pe niciun server — au confirmat asta explicit pe pagina lor). Extensia profită de asta: după ce descarci o piesă, ia bytes-ii fișierului deja descărcat (din cache-ul local al serverului) și îi „livrează" direct în input-ul de upload al Tunebat, exact cum ar face selecția manuală a fișierului — Tunebat pornește analiza automat de-acolo.

Tunebat e o aplicație randată complet în browser (HTML-ul lui nu conține widget-ul de upload), așa că extensia nu așteaptă încărcarea completă a paginii (reclame, analytics) și nici o pauză fixă: verifică la fiecare 100 ms până când input-ul de upload există și React l-a inițializat, apoi inserează fișierul imediat — de obicei în mai puțin de o jumătate de secundă, față de ~2 s înainte. Dacă inserarea eșuează, un mesaj apare direct pe pagina Tunebat.

Asta rulează dintr-un **service worker** al extensiei (`background.js`), ca să funcționeze chiar dacă închizi popup-ul înainte să se termine descărcarea — starea „descărcat" se salvează, iar butonul Tunebat apare oricând redeschizi popup-ul pe aceeași piesă.

## Viteza descărcării

Timpi măsurați pe un MP3 de 3:33 (YouTube), de la deschiderea popup-ului până la fișier:

| | Înainte | Acum |
|---|---|---|
| Titlul + thumbnail-ul apar | ~3-8 s | instant (din tab) |
| Analiza (uploader, durată) | ~3-8 s | ~3 s |
| Click pe MP3 → fișier | ~20 s | ~1-2 s (aproape 0 dacă aștepți puțin) |

Ce s-a schimbat:

- **Prioritatea serviciului pe Mac**: `launchd` pornea serverul cu `ProcessType=Background` + `Nice`, iar copiii lui (yt-dlp, ffmpeg) moșteneau prioritatea minimă — tot ce făcea serverul mergea de 3-4× mai încet decât la o rulare normală. Acum e `Interactive` (prioritate normală, verificat cu `ps`). Consumul la inactivitate rămâne ~0%. **Pe Windows**, Task Scheduler pornește implicit task-urile cu prioritate „below normal" — `install.ps1` setează acum `-Priority 4` (normal); **rulează-l din nou, ca Administrator, la studio** ca să se aplice.
- **O singură extragere yt-dlp per piesă**: extragerea (pagina + player + JS challenge) e partea lentă (~3 s), descărcarea propriu-zisă a audio-ului durează sub 1 s. Analiza salvează acum metadatele complete (`<id>.info.json`), iar descărcarea le reîncarcă (`--load-info-json`) în loc să extragă a doua oară. Pentru Spotify, căutarea salvează la fel metadatele videoclipului găsit.
- **Pregătire în fundal**: imediat ce analiza se termină, serverul descarcă sursa audio și face **și MP3, și WAV** cât timp te uiți la ecran. Dacă apeși MP3 între timp, cererea se alătură aceluiași job (nu se duplică nimic). Costul: câteva secunde de CPU și ~50 MB pe disc (șterse automat după 1 h) pentru fiecare link pe care deschizi extensia.
- **Butoanele MP3/WAV sunt active imediat** pe YouTube: titlul se ia din tab, thumbnail-ul din id-ul videoclipului; analiza doar completează uploader-ul și durata.
- **Normalizare de volum mai rapidă** (vezi mai jos): ~6 s → ~0,5 s.

Sursa audio se descarcă **o singură dată per piesă**; al doilea format se face local din ea, fără rețea. Înregistrările din tab-ul Sample se trimit ca bytes bruți (nu JSON+base64).

## Normalizare volum

Implicit, orice conversie (YouTube/Spotify/Instagram **și** Sample) ajunge la **-16 LUFS** (volum perceput), ca piesele/înregistrările să sune la fel de tare indiferent de sursă. Se măsoară volumul cu filtrul rapid `ebur128` (~0,4 s), apoi se aplică un câștig static + un limiter la -1,5 dBFS. Față de filtrul `loudnorm` folosit inițial (~6 s pe piesă) rezultatul e același ca volum (verificat: -16,0 LUFS, vârf -3,1 dBFS) și lasă dinamica piesei neatinsă. Piesele foarte încete sunt amplificate până la țintă, cele foarte tari sunt reduse, iar tăcerea rămâne neschimbată. Se poate dezactiva din tab-ul **Settings**.

## Actualizare yt-dlp

YouTube își schimbă des protecțiile, iar `yt-dlp` primește update-uri frecvente ca să țină pasul. Dacă descărcările încep să eșueze, rulează:

```bash
brew upgrade yt-dlp        # Mac
```

```powershell
winget upgrade yt-dlp.yt-dlp   # Windows
```

## Cum funcționează Spotify

Spre deosebire de YouTube, fișierele audio de pe Spotify sunt protejate prin DRM (Widevine). Ocolirea DRM este ilegală (legislație anti-circumvention), deci **nu se extrage direct din Spotify**. În schimb:

1. Deschizi un link către o piesă Spotify (`open.spotify.com/track/...`)
2. Serverul citește titlul și artistul direct de pe pagina Spotify (fără login, fără API key)
3. Caută automat pe YouTube „Artist - Titlu audio" și ia primul rezultat
4. De-acolo încolo, totul e identic cu fluxul YouTube (MP3/WAV)

**Important:** potrivirea e automată, fără confirmare — de obicei nimerește piesa/videoclipul oficial, dar ocazional poate găsi un cover, remix sau altă versiune dacă piesa exactă nu există pe YouTube sau dacă titlul de pe Spotify e ambiguu. Verifică mereu titlul afișat în extensie (`Găsit pe YouTube: „..."`) înainte să descarci, ca să te asiguri că e versiunea corectă.

Funcționează doar pentru link-uri către **o singură piesă** (track) — nu și playlist-uri sau albume.

## Cum funcționează Instagram (Story, Reel, Post)

Spre deosebire de Spotify, Instagram nu are DRM — dar Story-urile (și uneori conținutul de la conturi private) nu sunt accesibile fără autentificare. Serverul folosește **cookie-urile din Chrome, deja logat pe acest calculator** — exact sesiunea pe care o folosești oricum când navighezi pe Instagram, nu ceva separat sau ascuns. Nu se ocolește nicio protecție: dacă poți vedea conținutul în Chrome, serverul îl poate descărca.

**Link-uri acceptate:**
- Story activ: `instagram.com/stories/username/` (ia story-ul curent al contului)
- Story anume: `instagram.com/stories/username/123456789/`
- Reel: `instagram.com/reel/...` sau `instagram.com/reels/...`
- Post: `instagram.com/p/...`

**De reținut:**
- Trebuie să fii logat pe Instagram în Chrome pe acest calculator (contul cu care ai acces la conținutul respectiv — ex. dacă clientul ți-a trimis story-ul în DM sau te-a etichetat).
- Prima dată când serverul citește cookie-urile din Chrome, macOS poate cere o confirmare de Keychain — aprob-o o singură dată.
- Extractorul Instagram din `yt-dlp` e mai fragil decât cel de YouTube (Instagram își schimbă des structura site-ului) — dacă apar erori, primul pas e `brew upgrade yt-dlp` (Mac) / `winget upgrade yt-dlp.yt-dlp` (Windows).
- Un link de Story fără ID numeric (`.../stories/username/`) arată mereu story-ul **curent** — nu e cache-uit între cereri, ca să nu descarci accidental o versiune veche/expirată.

## Cum funcționează tab-ul Sample (înregistrare din tab)

Pentru cazurile în care clientul nu-ți trimite un link, ci îți cântă/redă direct un beat (ex. într-un apel video, sau o piesă care nu are link public) — tab-ul **Sample** înregistrează exact audio-ul care iese din tab-ul curent al Chrome-ului.

1. Deschide tab-ul unde rulează audio-ul (ex. tab-ul de Zoom/Meet, sau orice pagină care redă sunet)
2. Click pe iconița extensiei → tab-ul **Sample** → butonul roșu de rec
3. Audio-ul continuă să se audă normal (nu se oprește cât înregistrezi) — extensia doar „ascultă" în paralel; un indicator de nivel arată în timp real că se captează sunet
4. Click din nou ca să oprești — apare un waveform + player cu ce ai înregistrat, un câmp editabil pentru numele fișierului, plus **MP3**/**WAV** ca să descarci
5. (Opțional) Trage marginile waveform-ului ca să tai liniște/greșeli de la început sau sfârșit — dublu-click resetează la piesa întreagă. Redarea rămâne în intervalul selectat, ca să auzi exact ce descarci
6. La fel ca pe tab-ul Link, după ce descărcarea chiar se termină apare butonul **„Analyze BPM & Key on Tunebat"**

**Înregistrarea continuă chiar dacă închizi popup-ul** (ex. dai rec, închizi popup-ul, navighezi în alt tab, revii mai târziu și apeși stop) — rulează într-un „offscreen document" separat de popup, exact ca să nu fii nevoit să stai cu extensia deschisă cât timp se înregistrează un instrumental întreg. Bytes-ii înregistrării rămân în memoria acelui document (nu în `chrome.storage`, care are o limită de 10MB — o sesiune de câteva minute ar depăși-o ușor) — popup-ul îi cere înapoi doar când chiar are nevoie de ei (redare sau descărcare).

**De reținut:** cât timp înregistrezi, Chrome arată un indicator vizual (o iconiță) pe tab-ul capturat, ca să fie mereu clar când ceva e înregistrat.

## Formate de export (Link, Sample și File)

Toate cele trei tab-uri au aceeași grilă de butoane, un click = un fișier:

| Buton | Format |
|---|---|
| MP3 | MP3 320 kbps CBR |
| WAV | PCM necomprimat |
| FLAC | compresie lossless |
| AIFF | PCM necomprimat (Logic/Pro Tools/Mac) |
| M4A | AAC 320 kbps |
| OPUS | Opus 192 kbps |

Doar butonul apăsat afișează spinner cât se convertește; restul se estompează. **WAV, FLAC și AIFF păstrează 24-bit** dacă sursa e 24-bit (ex. un WAV 24-bit primit de la client); sursele lossy (YouTube, MP3, AAC, Opus) ies pe 16-bit, fiindcă 24-bit acolo n-ar aduce nimic. Frecvența de eșantionare se păstrează (MP3 și Opus se aduc automat la o frecvență suportată, ex. 96 kHz → 48 kHz). Pregătirea în fundal (vezi „Viteza descărcării") face din start MP3 și WAV; celelalte formate se convertesc la click din sursa deja descărcată, de obicei în 1-3 s.

## Tab-ul File (conversie + Tunebat)

Pentru un fișier pe care îl ai deja pe disc (trimis de client pe WhatsApp/mail/Drive):

1. Deschide extensia → tab-ul **File**
2. Trage fișierul în zonă (drag & drop) **sau** click în zonă și alege-l din file explorer — MP3, WAV, FLAC, AIFF, M4A, AAC, OGG sau OPUS, maxim 100 MB
3. Apar grila de formate și butonul **„Analyze BPM & Key on Tunebat"** (ambele doar după ce ai ales un fișier)
4. **Conversie**: click pe un format → fișierul se descarcă cu numele original și extensia nouă (ex. `Beat.wav` → `Beat.flac`). Fișierul se urcă pe serverul local o singură dată, deci mai multe formate la rând nu îl retrimit
5. **Tunebat**: se deschide cu fișierul deja inserat. Tunebat nu acceptă AIFF/OPUS, așa că acestea se convertesc automat întâi în WAV (fără normalizare de volum)

Copia de pe server (`/api/stash`, `/api/convert-stash`) se șterge automat după 1 oră. Conversiile respectă setarea „Normalize volume" din Settings (implicit ON — dezactiv-o dacă vrei ca fișierul convertit să păstreze exact nivelul original).

## Tab-ul Settings

Iconița de rotiță din colțul dreapta sus (lângă bulina de status server) deschide un al treilea tab:

- **Normalize volume on export** — dezactivează normalizarea de volum (vezi mai sus) dacă vrei fișierul exact cum a fost sursa
- **Status server** — text complet (nu doar bulina) + buton de reverificare, util dacă tocmai ai pornit server-ul și nu vrei să închizi/redeschizi popup-ul
- **Clear cached data** — șterge datele reținute de extensie (piese cache-uite, tab-ul activ, descărcări în așteptare) — nu atinge fișierele deja salvate pe disc

## Sincronizare între Mac și Windows (Git)

Codul se ține într-un repo Git privat, ca Mac-ul de acasă și PC-ul din studio să ruleze exact aceeași versiune.

**Prima dată, pe PC-ul din studio** (PowerShell; ai nevoie de `git` — `winget install Git.Git` — și de acces la repo):

```powershell
git clone <URL-ul repo-ului> instrumental-downloader
cd instrumental-downloader\server
npm install
cd ..\autostart\windows
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install.ps1
```

Apoi instalează extensia din `extension\` (pasul 3 de mai sus).

**La fiecare update** (după ce modificările au fost trimise cu `git push` de pe celălalt calculator):

```powershell
.\autostart\update.ps1      # Windows
```

```bash
./autostart/update.sh       # Mac
```

Scriptul face `git pull`, `npm install` și repornește serverul. Dacă s-a schimbat ceva în `extension/`, apasă ↻ pe extensie în `chrome://extensions`.

`CLAUDE.md` din rădăcina proiectului conține contextul proiectului (arhitectură, decizii, preferințe) — Claude Code îl citește automat când deschizi o sesiune în acest folder, pe oricare dintre calculatoare.

## Structură proiect

```
instrumental-downloader/
├── server/               # Backend Node.js (yt-dlp + ffmpeg, API pentru extensie)
│   ├── server.js
│   └── lib/ytdlp.js, lib/youtube.js, lib/instagram.js, lib/spotify.js
├── extension/            # Extensie Chrome (Manifest V3)
│   ├── manifest.json
│   ├── icons/             # icon-ul extensiei (16/32/48/128px)
│   ├── popup.html/css/js  # tab-uri File + Link + Sample + Settings
│   ├── background.js     # service worker: descărcări, Tunebat, coordonare Sample
│   └── offscreen.html/js # document offscreen: face efectiv înregistrarea audio
├── autostart/            # Scripturi de pornire automată la login + update
│   ├── mac/install.sh / uninstall.sh
│   ├── windows/install.ps1 / uninstall.ps1
│   └── update.sh / update.ps1   # git pull + npm install + restart server
└── CLAUDE.md             # context proiect pentru Claude Code
```
