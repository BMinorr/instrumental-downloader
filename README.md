# Studio Instrumental Downloader

Extensie Chrome + server local pentru descărcarea instrumentalelor pe care ți le trimit clienții.

**Faza 1 (gata):** YouTube → MP3 320kbps sau WAV.
**Faza 2 (gata):** Spotify — caută automat echivalentul pe YouTube și descarcă de-acolo (vezi nota despre DRM mai jos).
**Faza 3 (gata):** Instagram — Story, Reel și Post, cu autentificare din Chrome (vezi mai jos).
**Faza 4 (gata):** tab „Sample" — înregistrează audio-ul care redă din tab-ul curent (ex. un beat pe care clientul ți-l cântă live într-un apel video), apoi descarcă-l ca MP3 320kbps sau WAV.

Extensia are, în stânga, tab-urile **Link** (YouTube/Spotify/Instagram — tab-ul implicit; lipești un link, mai multe sau un playlist), **File** (alegi/tragi un fișier audio local și îl convertești) și **Sample** (înregistrare directă din tab), iar în dreapta **History** și **Settings**. Tab-urile arată doar pictograma; textul apare lângă pictograma tab-ului activ (și la hover). Cele din stânga se pot ascunde și reordona din Settings, History se poate ascunde. După fiecare descărcare, BPM-ul și cheia se iau **automat** de pe Tunebat (într-un tab în fundal) și ajung în numele fișierului.

## De ce ai nevoie de un server local

YouTube nu permite extragerea audio doar din extensia de browser (stream-urile sunt protejate/adaptive). Soluția standard e ca extensia să trimită link-ul către un mic server care rulează pe calculatorul tău din studio, care face descărcarea/conversia cu `yt-dlp` + `ffmpeg`. De aceea trebuie să pornești serverul înainte să folosești extensia.

Serverul pornește **automat la login** (pe Mac și pe Windows) și rulează în fundal — nu trebuie să deschizi Terminal de fiecare dată. Consum măsurat la inactivitate: ~0% CPU, ~25-50MB RAM, deci nu afectează vizibil bateria laptopului. Procesul de utilizare zilnică (deschide YouTube → click extensie → alege format) e **identic pe Mac și pe Windows**.

## 1. Instalare (o singură dată)

### Instalare rapidă (calculator nou sau un prieten) — un singur fișier

Repo-ul e public, iar installer-ul instalează **tot**: Git, Node.js, ffmpeg, yt-dlp, aplicația, pornirea automată a serverului. Singurul pas manual rămas e încărcarea extensiei în Chrome (Chrome nu permite altfel), iar installer-ul îl ghidează (deschide Chrome și folderul, copiază calea).

- **Windows:** trimite fișierul [`install/Install-Windows.bat`](install/Install-Windows.bat) și spune-i să dea dublu-click (Windows poate cere permisiuni; e normal). Sau, într-un PowerShell:
  ```powershell
  irm https://raw.githubusercontent.com/BMinorr/instrumental-downloader/main/install/install.ps1 | iex
  ```
- **Mac:** într-un Terminal:
  ```bash
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/BMinorr/instrumental-downloader/main/install/install.sh)"
  ```
  (sau [`install/Install-Mac.command`](install/Install-Mac.command), click dreapta → Open la prima rulare)

**De ce rămâne valabil în timp:** fișierul `.bat`/`.command` conține doar adresa installer-ului, care se descarcă de fiecare dată **în versiunea de atunci** și instalează ultima versiune a aplicației. Deci un fișier primit la v0.1.0 instalează corect și peste un an. După instalare, actualizările vin din extensie (Settings → Updates). Installer-ul se poate rula oricând din nou (repară ce lipsește, aduce ultima versiune). Aplicația se instalează în `~/InstrumentalDownloader` (Windows: `%USERPROFILE%\InstrumentalDownloader`).

**Pornirea automată pe Windows nu cere Admin** (task doar pentru utilizatorul curent). Dacă există deja un task `InstrumentalDownloaderServer` creat cu drepturi de Administrator și nu poate fi înlocuit, installer-ul îți spune clar ce să faci (rulează o dată ca Administrator sau șterge task-ul din Task Scheduler) și pornește serverul pentru sesiunea curentă.

Instalarea manuală, pas cu pas, e descrisă mai jos.

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

1. Deschide un videoclip YouTube (instrumentalul trimis de client) — sau copiază link-ul și lipește-l în extensie
2. Click pe iconița extensiei, apoi pe un format (MP3, WAV, FLAC…)
3. Fișierul apare imediat în Downloads-urile Chrome. În câteva secunde, în fundal, BPM-ul și cheia sunt citite de pe Tunebat, iar fișierul e salvat din nou cu numele final (`Beat - 140bpm - Am - Producer.mp3`), iar prima copie se șterge

(Serverul rulează deja automat în fundal — vezi pasul 2 de mai sus.)

## Analiza automată pe Tunebat (BPM și cheie)

Tunebat analizează fișierele **local, în browser** (nu le trimite pe niciun server). După fiecare descărcare, extensia (service worker-ul din fundal) face asta pentru tine:

1. deschide **Tunebat într-un tab în fundal** (tab-ul tău rămâne cel activ) și îi „dă" fișierul — exact ca o selecție manuală, cu `File`-ul creat în contextul paginii ca React-ul lor să nu-l respingă. Nu așteaptă încărcarea completă a paginii (reclame): verifică la 100 ms până când widget-ul de upload există și e gata
2. citește rândul de rezultat — **doar BPM și cheia** — îl găsește după conținut, nu după clase CSS (sunt hash-uite și se schimbă)
3. salvează fișierul din nou sub **numele final**, cu BPM și cheie și în tag-uri (MP3/FLAC: `TBPM`/`TKEY`, `BPM`/`INITIALKEY`), apoi **șterge prima copie** — dar doar după ce copia nouă s-a terminat de salvat; dacă orice pas eșuează, prima copie rămâne neatinsă
4. scrie rezultatul în History (și în coadă) — extensia îl arată sub butoanele de format într-un **tabel cu două coloane** (BPM | Key), fără alt text; cât timp analiza rulează, celulele arată un spinner

**Tabelul de reverb** — sub tabelul BPM | Key (carduri și History), imediat ce BPM-ul e cunoscut, apare un tabel cu trei coloane: *Reverb size* | *Pre-delay* | *Decay time*, calculat local din BPM cu aceeași formulă ca [calculatorul de pe anotherproducer.com](https://anotherproducer.com/online-tools-for-musicians/delay-reverb-time-calculator/). Prima coloană arată doar durata (2 Bars, 1 Bar, 1/2 Note, 1/4 Note); *Pre-delay* e în ms, *Decay time* în secunde, tăiat (nu rotunjit) la 3 zecimale (3937,5 ms → 3.937 s). Un click pe orice celulă copiază valoarea (numărul, fără unitate, gata de lipit într-un plugin). Se afișează doar în UI; nu intră în numele fișierului.

Mai multe fișiere la rând (o coadă, un playlist) folosesc **același tab Tunebat** — pagina se încarcă o singură dată — care se închide după câteva secunde de inactivitate. AIFF și Opus nu sunt acceptate de Tunebat, iar un fișier lossless foarte mare (peste 30 MB) e lent de predat paginii: pentru ele se analizează o copie WAV mono 22 kHz făcută pe loc (~4× mai mică, cu tot ce trebuie pentru BPM și cheie; nu se salvează nicăieri). Se poate opri, sau se poate lăsa tab-ul deschis / prima copie nesștearsă, din Settings → „BPM & key (Tunebat)". Cu „Ask where to save each file" pornit, analiza rulează dar fișierul nu se mai salvează a doua oară (nu vrem un al doilea dialog).

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

Implicit, orice conversie (YouTube/Spotify/Instagram **și** Sample) ajunge la **-16 LUFS** (volum perceput), ca piesele/înregistrările să sune la fel de tare indiferent de sursă. Se măsoară volumul cu filtrul rapid `ebur128` (~0,4 s), apoi se aplică un câștig static + un limiter la -1,5 dBFS. Față de filtrul `loudnorm` folosit inițial (~6 s pe piesă) rezultatul e același ca volum (verificat: -16,0 LUFS, vârf -3,1 dBFS) și lasă dinamica piesei neatinsă. Piesele foarte încete sunt amplificate până la țintă, cele foarte tari sunt reduse, iar tăcerea rămâne neschimbată. Se poate dezactiva (separat pentru Link, Sample și File) și i se poate schimba ținta din tab-ul **Settings**.

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
6. La fel ca pe tab-ul Link, după export începe analiza automată pe Tunebat (BPM și cheie în numele fișierului)

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

## Tab-ul File (analiză + conversie)

Pentru un fișier pe care îl ai deja pe disc (trimis de client pe WhatsApp/mail/Drive):

1. Deschide extensia → tab-ul **File**
2. Trage fișierul în zonă (drag & drop) **sau** click în zonă și alege-l din file explorer — MP3, WAV, FLAC, AIFF, M4A, AAC, OGG sau OPUS, maxim 100 MB
3. **Imediat ce fișierul e pus, pleacă singur la Tunebat** (în fundal) și în câteva secunde apare tabelul `BPM | Key` sub butoane
4. Click pe un format → fișierul se descarcă convertit, cu numele din blocurile din Settings — iar BPM-ul și cheia sunt **deja în nume** (nu mai e o a doua analiză, nici o a doua salvare). Dacă analiza încă mai rulează, conversia o așteaptă până la 15 secunde

Fișierul se urcă pe serverul local (`/api/stash`) o singură dată, când e adăugat, și e refolosit pentru analiză și pentru toate conversiile; copia se șterge automat după 1 oră. Conversiile din File **nu** normalizează volumul implicit; comutatorul „File conversions" din Settings îl activează. Analiza la adăugare se oprește din Settings („Files, when added").

## Tab-ul Link: un link, mai multe sau un playlist

Câmpul de sus primește orice: copiezi link-ul primit de la client, deschizi extensia, lipești (Ctrl/Cmd+V) — se încarcă singur. Enter trimite, Shift+Enter adaugă o linie, iar Enter pe câmp gol revine la pagina din tab-ul curent. Pe o pagină nesuportată câmpul are deja focus.

- **Un singur link** → previzualizare (titlul și thumbnail-ul apar imediat) și butoanele de format
- **Mai multe link-uri** (unul pe rând) **sau un playlist YouTube** (`/playlist?list=…` sau un link de video cu `list=…`, până la 100 de piese) → apare „N tracks ready"; alegi formatul și tot lotul intră în **coadă**

Coada apare sub butoane și rulează **în fundal** (service worker-ul extensiei), deci continuă cu popup-ul închis: câte **două piese odată** (extragerea yt-dlp e în mare parte așteptare pe rețea, deci se suprapun frumos), fiecare salvată cu numele și setările tale, apoi trimisă la analiza Tunebat. Pe icon apare câte au mai rămas, apoi ✓ (sau ! dacă au fost erori). Dacă browserul oprește worker-ul la jumătate, piesele întrerupte reiau singure. Spotify: doar piese individuale (nu playlist-uri/albume). Coada ignoră „Ask where to save".

## Tab-ul History

Ultimele 30 de descărcări (Link, Sample, File), fiecare cu rezultatul analizei (tabelul `BPM | Key`), **Show in folder**, **Analyze again** (dacă analiza a eșuat și copia de pe server încă există) și — pentru Link — **Download again in another format**. „Clear history" îl golește; „Clear cached data" din Settings îl păstrează.

## Tab-ul Sample: Trim silence și fade

Sub waveform: **Trim silence** mută mânerele pe primul și ultimul sunet (prag -40 dBFS, cu 50 ms înainte și 150 ms după), **Fade in / Fade out** (off, 0,5 s, 1 s, 2 s) se aplică la export. Trim-ul și fade-urile rulează în ffmpeg ca filtre pe aceeași axă de timp (deci fade-out-ul începe exact înainte de capătul tăiat).

**Înregistrare fără popup:** scurtătura **Alt+Shift+R** (schimbabilă în Chrome → Extensions → Keyboard shortcuts, sau din Settings → Change) pornește/oprește înregistrarea tab-ului curent fără să deschizi extensia. Iconița arată **REC** cât înregistrează și **✓** când e gata; deschide popup-ul ca s-o preiei.

## Nume de fișier: blocuri

Settings → **File names**: numele fișierelor se compun din **blocuri** pe care le tragi (drag & drop) în ordinea dorită: **Beat name** (titlul), **BPM**, **Key**, **Producer** (canalul/uploader-ul) — ordinea implicită — plus **Date**, **Format** și **Custom text**. Tragi un bloc în „Available" (sau apeși ×) ca să-l scoți, apeși „+" ca să-l adaugi; alegi separatorul (` - `, `_`, spațiu, ` | `), cum se scrie BPM-ul (**`140bpm`**, `140 BPM` sau `140`) și cheia (**`Am`** / `A minor`) și vezi imediat o previzualizare (`Midnight Drive - 140bpm - Am - Beatmaker.mp3`). Blocurile fără valoare se sar (BPM și cheia lipsesc până vine analiza; o înregistrare nu are producer), iar un producer care apare deja în titlu („Producer - Beat") nu se repetă.

**Tags & cover art** (implicit ON): descărcările Link primesc titlu, artist (uploader) și linkul sursă, plus imaginea videoclipului (tăiată pătrat, 600 px) drept copertă — în MP3, M4A, FLAC și AIFF; WAV primește doar tag-uri text, Opus doar tag-uri.

## Actualizare yt-dlp din extensie

Settings → **Updates** arată, pe două rânduri, versiunea instalată și dacă există una mai nouă: **Downloader** (extensia + serverul, din Git) și **yt-dlp**. La yt-dlp, „Update" o actualizează cu aceeași metodă cu care a fost instalat (`brew upgrade yt-dlp` pe Mac cu Homebrew, `winget upgrade` pe Windows cu winget, altfel `yt-dlp -U`). Când o descărcare eșuează cu o eroare de tip yt-dlp, mesajul te trimite aici. *(Actualizarea propriu-zisă n-a fost rulată în testele mele, ca să nu modific software-ul instalat; verificarea versiunii e testată.)*

## Securitate

Serverul local răspunde doar extensiei: orice cerere cu un `Origin` care nu e `chrome-extension://…` primește 403, deci un site web nu poate declanșa descărcări sau o actualizare yt-dlp prin `fetch`/formular către `127.0.0.1:5177`. (Doar pentru teste: variabila `ALLOWED_ORIGINS="http://host:port"` adaugă origini.)

## Tab-ul Settings

Rotița din colțul dreapta sus. Setările se salvează automat și se păstrează chiar dacă apeși „Clear cached data".

**Volume normalization** — un comutator separat pentru *Link downloads* și *Sample recordings* (implicit pornite) și *File conversions* (implicit oprit). **Target loudness**: -14, -16 (implicit) sau -18 LUFS.

**File names** — blocurile de mai sus. **BPM & key (Tunebat)** — analiza pe rând pentru *Link downloads*, *Sample recordings* și *Files, when added* (toate implicit ON), plus *Delete the first copy* și *Close the Tunebat tab when done* (implicit ON).

**Tabs** — tragi ca să reordonezi Link / File / Sample (History rămâne în dreapta, lângă Settings) și comuți ca să ascunzi (măcar unul rămâne vizibil; Settings e mereu acolo). Un tab ascuns nu costă nimic — de pildă, cu Link ascuns extensia nu mai pornește analiza și pregătirea în fundal la fiecare deschidere.

**Downloads** — *Ask where to save each file*, *Subfolder* (`Downloads/<subfolder>`), *Tags & cover art*. **Formats shown** — ce formate apar în grile (minim unul). **General** — *Open on* (ultimul tab sau unul dintre cele vizibile), *Prepare MP3 & WAV in advance* (vezi „Viteza descărcării"), *Record shortcut*.

**Local server** — indicatorul de status (punct + „Connected"/„Not connected", cu punct roșu pe rotiță cât e oprit), **Updates** — verificare automată (o dată la 6 ore, la deschiderea extensiei; un punct albastru pe rotiță când e ceva nou), *Check for updates now*, Update pentru Downloader și pentru yt-dlp, **Data** — *Clear cached data* (uită paginile reținute și ultimul tab; **nu** atinge setările, istoricul, coada sau analizele în curs).

În subsolul panoului: versiunea și „by B Minor" (link către [bminorr.github.io](https://bminorr.github.io/)).

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
│   ├── shared.js         # setări, blocurile de nume, istoric, helper de descărcare (popup + worker)
│   ├── dom.js, popup.js, tab-*.js   # popup-ul: câte un fișier pe tab (link, file, sample, history, settings)
│   ├── queue-engine.js, analysis-engine.js, tunebat.js   # worker-ul: coada, analiza automată Tunebat, paginile Tunebat
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


## Update-ul aplicației din Settings (Downloader)

Settings → **Updates → Downloader**: serverul face `git fetch` și compară cu `origin` (la deschiderea extensiei, cel mult o dată la 6 ore, dacă „Check automatically" e pornit). Dacă există ceva nou apare **Update** (și un punct albastru pe rotiță). Apăsat, serverul rulează `git pull --ff-only`, `npm install` doar dacă s-a schimbat `package.json`, apoi **se repornește singur** (Mac: launchd îl repornește; Windows: un mic proces ajutător) și extensia se **reîncarcă singură** (`chrome.runtime.reload()`), deci nu mai e nevoie de ↻ manual. Nu merge dacă folderul nu e clonat cu Git sau are fișiere modificate de mână (mesajul spune asta). Prima dată, pe un calculator care n-are încă funcția, rulează o dată `update.sh` / `update.ps1`.

Fiecare opțiune din Settings are un **ⓘ** mic după nume: click = o explicație de 1–2 propoziții.

## Fereastra „Detached"

Butonul **Detached** (doar pictograma, fără text; în antet, în dreapta rotiței Settings) deschide extensia într-o **fereastră mică de Chrome** (nu fullscreen), dimensionată cât să încapă interfața (lățime ~336 px, înălțime până la 680 px, poziționată lângă fereastra curentă); popup-ul se închide. Un al doilea click aduce în față fereastra deja deschisă, nu face alta. În fereastra detașată:
- **Link** folosește doar link-urile pe care le lipești tu în interfață (nu ia pagina din tab-ul curent);
- **Sample** e ascuns (înregistrarea din tab n-are sens acolo);
- File, History și Settings merg la fel; dialogul de alegere a fișierului nu mai închide fereastra (la popup-ul obișnuit se putea);
- își ține minte propriul tab activ, separat de popup.

**Settings → General → „Open in pop-out window"** (oprit implicit): când e pornit, un click pe pictograma extensiei din Chrome deschide direct fereastra detașată, fără dropdown (dacă e deja deschisă, o aduce în față). Se oprește din rotița din fereastra detașată.

## Tabelele BPM/Key și reverb: mereu pe ecran

Cele două tabele (BPM | Key și Reverb size | Pre-delay | Decay time) apar **din start** în Link, File și Sample (și în rândurile din History): goale înainte să se întâmple ceva, cu un **cerc de încărcare** în fiecare celulă cât timp Tunebat analizează, apoi cu valorile (click pe o valoare = copiată). La eșec celulele arată „—".

## Versionare

Versiunea curentă e **1.0.1** (`extension/manifest.json`, afișată în Settings). Corecțiile mici, retușurile vizuale și schimbările de backend cresc ultima cifră (1.0.1, 1.0.2…); o funcționalitate nouă crește cifra din mijloc (1.1.0).
