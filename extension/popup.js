const SERVER = "http://127.0.0.1:5177";
const TUNEBAT_URL = "https://tunebat.com/Analyzer";

const els = {
  statusMessage: document.getElementById("status-message"),
  trackInfo: document.getElementById("track-info"),
  thumbnail: document.getElementById("thumbnail"),
  trackTitle: document.getElementById("track-title"),
  trackMeta: document.getElementById("track-meta"),
  formatOptions: document.getElementById("format-options"),
  progress: document.getElementById("progress"),
  serverDot: document.getElementById("server-status"),
  btnTunebat: document.getElementById("btn-tunebat"),
  tabFile: document.getElementById("tab-file"),
  tabLink: document.getElementById("tab-link"),
  tabSample: document.getElementById("tab-sample"),
  panelFile: document.getElementById("panel-file"),
  panelLink: document.getElementById("panel-link"),
  panelSample: document.getElementById("panel-sample"),
  sampleStatus: document.getElementById("sample-status"),
  sampleResult: document.getElementById("sample-result"),
  sampleAudio: document.getElementById("sample-audio"),
  sampleFormatOptions: document.getElementById("sample-format-options"),
  sampleProgress: document.getElementById("sample-progress"),
  sampleBtnDiscard: document.getElementById("sample-btn-discard"),
  sampleTimer: document.getElementById("sample-timer"),
  sampleRecordBtn: document.getElementById("sample-record-btn"),
  sampleWaveform: document.getElementById("sample-waveform"),
  sampleFilename: document.getElementById("sample-filename"),
  sampleLevelMeter: document.getElementById("sample-level-meter"),
  sampleLevelFill: document.getElementById("sample-level-fill"),
  samplePlayBtn: document.getElementById("sample-play-btn"),
  sampleBtnTunebat: document.getElementById("sample-btn-tunebat"),
  tabSettings: document.getElementById("tab-settings"),
  panelSettings: document.getElementById("panel-settings"),
  settingLoudnorm: document.getElementById("setting-loudnorm"),
  settingsServerText: document.getElementById("settings-server-text"),
  settingsBtnRecheck: document.getElementById("settings-btn-recheck"),
  settingsBtnClearCache: document.getElementById("settings-btn-clear-cache"),
  fileInput: document.getElementById("file-input"),
  fileDropzone: document.getElementById("file-dropzone"),
  fileDropzoneTitle: document.getElementById("file-dropzone-title"),
  fileDropzoneSub: document.getElementById("file-dropzone-sub"),
  fileDropzoneFormats: document.getElementById("file-dropzone-formats"),
  fileClear: document.getElementById("file-clear"),
  fileFormatOptions: document.getElementById("file-format-options"),
  fileProgress: document.getElementById("file-progress"),
  btnFileTunebat: document.getElementById("btn-file-tunebat"),
};

// Output formats offered on every tab (Link, Sample, File). `id` is what the server
// expects (see FORMATS in server/lib/ytdlp.js — keep both lists in sync).
const FORMATS = [
  { id: "mp3", label: "MP3", sub: "320 kbps", title: "MP3, 320 kbps CBR" },
  { id: "wav", label: "WAV", sub: "PCM", title: "WAV, uncompressed PCM (24-bit if the source is 24-bit)" },
  { id: "flac", label: "FLAC", sub: "lossless", title: "FLAC, lossless compression (24-bit if the source is 24-bit)" },
  { id: "aiff", label: "AIFF", sub: "PCM", title: "AIFF, uncompressed PCM (24-bit if the source is 24-bit)" },
  { id: "m4a", label: "M4A", sub: "AAC 320", title: "M4A, AAC 320 kbps" },
  { id: "opus", label: "OPUS", sub: "192 kbps", title: "Opus, 192 kbps" },
];

// Fills `container` with one button per format. Picking a format calls `onPick(id)`.
// Returns controls shared by all three tabs:
//   setLoading(on) — data not ready yet: every button shows a spinner and is disabled
//   setBusy(id|null) — a conversion is running: only that button spins, all are disabled
function createFormatGrid(container, onPick) {
  const buttons = new Map();
  for (const format of FORMATS) {
    const button = document.createElement("button");
    button.className = "format-btn";
    button.title = format.title;
    button.innerHTML =
      '<span class="spinner"></span><span class="btn-label"></span><span class="btn-sub"></span>';
    button.querySelector(".btn-label").textContent = format.label;
    button.querySelector(".btn-sub").textContent = format.sub;
    button.addEventListener("click", () => onPick(format.id));
    container.appendChild(button);
    buttons.set(format.id, button);
  }
  return {
    setLoading(on) {
      for (const button of buttons.values()) {
        button.classList.toggle("loading", on);
        button.disabled = on;
      }
    },
    setBusy(activeId) {
      for (const [id, button] of buttons) {
        button.classList.toggle("loading", id === activeId);
        button.disabled = activeId !== null;
      }
    },
  };
}

const linkGrid = createFormatGrid(els.formatOptions, (id) => handleDownload(id));
const sampleGrid = createFormatGrid(els.sampleFormatOptions, (id) => handleSampleDownload(id));
const fileGrid = createFormatGrid(els.fileFormatOptions, (id) => handleFileConvert(id));

let currentCacheKey = null;
// What the MP3/WAV buttons act on. Set by renderTrack (possibly twice for YouTube: first
// an instant preview built from the tab itself, then the server's authoritative data).
let currentMedia = null; // { url, title }

function extractMediaId(url) {
  const ytMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/i);
  if (ytMatch) return ytMatch[1];
  const igMatch = url.match(/instagram\.com\/(?:stories\/[\w.]+(?:\/(\d+))?|(?:p|reels?)\/([\w-]+))/i);
  if (igMatch) return igMatch[1] || igMatch[2];
  const spMatch = url.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([\w]+)/i);
  if (spMatch) return `spotify-${spMatch[1]}`;
  return null;
}

function detectPlatform(url) {
  if (!url) return "unknown";
  if (/(^https?:\/\/(www\.|m\.)?youtube\.com\/)|(^https?:\/\/youtu\.be\/)/i.test(url)) {
    return "youtube";
  }
  if (/open\.spotify\.com/i.test(url)) return "spotify";
  if (/instagram\.com/i.test(url)) return "instagram";
  return "unknown";
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

async function checkServer() {
  try {
    const res = await fetch(`${SERVER}/health`);
    if (!res.ok) throw new Error();
    els.serverDot.classList.add("ok");
    return true;
  } catch {
    els.serverDot.classList.add("err");
    return false;
  }
}

async function main() {
  els.btnTunebat.addEventListener("click", makeTunebatHandler(els.btnTunebat, els.progress));
  initFileTab();
  initSampleTab();
  initSettingsTab();

  // Tab restore (storage read) and the active-tab lookup don't depend on each other.
  const [, [tab]] = await Promise.all([
    setupTabs(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const url = tab?.url || "";
  const platform = detectPlatform(url);

  if (platform === "unknown") {
    els.statusMessage.textContent =
      "Open a YouTube video, a Spotify track, or an Instagram Story/Reel/Post to download it.";
    els.statusMessage.classList.remove("hidden");
    checkServer();
    return;
  }

  currentCacheKey = extractMediaId(url);

  // Per-page cache: if this link was already processed, show everything instantly
  // with no network calls at all — zero wait on reopen.
  if (currentCacheKey) {
    const cached = await getCachedBundle(currentCacheKey);
    if (cached) {
      checkServer();
      renderTrack(cached.mediaUrl, cached);
      updateTunebatButton(els.btnTunebat, cached.downloadedFile);
      return;
    }
  }

  showSkeleton();
  if (platform === "youtube") showInstantPreview(url, tab?.title);

  const serverOk = await checkServer();
  if (!serverOk) {
    els.statusMessage.textContent = "Start the local server (server/npm start) to download.";
    els.statusMessage.classList.remove("hidden");
    els.trackInfo.classList.add("hidden");
    els.formatOptions.classList.add("hidden");
    return;
  }

  if (platform === "spotify") {
    await handleSpotify(url);
  } else {
    // YouTube and Instagram share the same direct flow (the server decides the platform from the link).
    await handleDirect(url);
  }
}

function showSkeleton() {
  els.trackInfo.classList.remove("hidden");
  setThumbnail(null);
  els.trackTitle.textContent = "Loading…";
  els.trackTitle.classList.add("placeholder");
  els.trackMeta.textContent = "";

  els.formatOptions.classList.remove("hidden");
  linkGrid.setLoading(true);
}

async function handleDirect(url) {
  try {
    const res = await fetch(`${SERVER}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, loudnorm: await getLoudnormSetting() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    renderTrack(url, data);
    if (currentCacheKey) setCachedBundle(currentCacheKey, { ...data, mediaUrl: url });
  } catch (err) {
    els.statusMessage.textContent = `Error: ${err.message}`;
    els.statusMessage.classList.remove("hidden");
    els.trackInfo.classList.add("hidden");
    els.formatOptions.classList.add("hidden");
  }
}

async function handleSpotify(spotifyUrl) {
  try {
    const res = await fetch(`${SERVER}/api/spotify-resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: spotifyUrl, loudnorm: await getLoudnormSetting() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    els.statusMessage.textContent = `Found on YouTube: "${data.youtube.title}"`;
    els.statusMessage.classList.remove("hidden");
    renderTrack(data.youtube.url, data.youtube);
    if (currentCacheKey) setCachedBundle(currentCacheKey, { ...data.youtube, mediaUrl: data.youtube.url });
  } catch (err) {
    els.statusMessage.textContent = `Error: ${err.message}`;
    els.statusMessage.classList.remove("hidden");
    els.trackInfo.classList.add("hidden");
    els.formatOptions.classList.add("hidden");
  }
}

function renderTrack(mediaUrl, data) {
  currentMedia = { url: mediaUrl, title: data.title };

  els.trackInfo.classList.remove("hidden");
  // Keep an already-loaded preview thumbnail instead of swapping in the (identical) one
  // from the server, which would flash the placeholder again.
  if (!els.thumbnail.getAttribute("src")) {
    setThumbnail(data.thumbnail);
    if (!data.thumbnail) els.thumbnail.parentElement.classList.remove("loading"); // nothing coming
  }
  els.trackTitle.textContent = data.title || "Untitled";
  els.trackTitle.classList.remove("placeholder");
  els.trackMeta.textContent = [data.uploader, formatDuration(data.duration)]
    .filter(Boolean)
    .join(" · ");

  els.formatOptions.classList.remove("hidden");
  linkGrid.setLoading(false);
}

// Gray placeholder box (#thumb-box) until the thumbnail has actually loaded.
function setThumbnail(url) {
  const img = els.thumbnail;
  const box = img.parentElement;
  img.classList.remove("loaded");
  box.classList.add("loading");
  img.onload = () => {
    img.classList.add("loaded");
    box.classList.remove("loading");
  };
  img.onerror = () => box.classList.remove("loading"); // stay a plain gray box, stop pulsing
  if (url) img.src = url;
  else img.removeAttribute("src");
}

// YouTube pages: the title is already in the tab and the thumbnail URL follows from
// the video id, so show both immediately and enable MP3/WAV — the server's analysis
// (~3s, yt-dlp) then only fills in uploader + duration. A download clicked meanwhile
// simply waits on that same analysis server-side.
function showInstantPreview(url, tabTitle) {
  const id = extractMediaId(url);
  const title = (tabTitle || "")
    .replace(/^\(\d+\)\s*/, "") // "(3) " unread-notification prefix
    .replace(/\s*-\s*YouTube$/, "")
    .trim();
  if (!id || !title || title === "YouTube") return;

  els.thumbnail.removeAttribute("src");
  setThumbnail(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
  renderTrack(url, { title });
}

async function handleDownload(format) {
  if (!currentMedia) return;
  const url = currentMedia.url;
  linkGrid.setBusy(format);
  els.progress.classList.remove("hidden");
  els.progress.textContent = "Downloading and converting...";

  try {
    const loudnorm = await getLoudnormSetting();
    const res = await fetch(`${SERVER}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, format, loudnorm }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    // Read the title now, not at click time: it may have been refined by the analysis.
    const safeTitle = (currentMedia.title || "instrumental").replace(/[\\/:*?"<>|]/g, "_");
    const filename = `${safeTitle}.${format}`;
    const fileUrl = `${SERVER}${data.downloadUrl}`;

    const downloadId = await chrome.downloads.download({
      url: fileUrl,
      filename,
      saveAs: false,
    });

    els.progress.textContent = "Download started — check Chrome's downloads bar.";
    trackDownloadCompletion(downloadId, fileUrl, filename, els.btnTunebat, currentCacheKey);
  } catch (err) {
    els.progress.textContent = `Error: ${err.message}`;
  } finally {
    linkGrid.setBusy(null);
  }
}

// Shows a Tunebat button once the file is actually finished saving (not just
// requested). Also persists it via the background worker (see background.js) so
// it still shows up if the popup gets closed and reopened before the download
// finishes. Shared by both the Link tab and the Sample tab.
function trackDownloadCompletion(downloadId, fileUrl, filename, buttonEl, cacheKey) {
  if (cacheKey) {
    chrome.storage.local.set({
      [`pendingDownload:${downloadId}`]: { cacheKey, fileUrl, filename },
    });
  }

  function onChanged(delta) {
    if (delta.id !== downloadId) return;
    if (delta.state && delta.state.current === "complete") {
      chrome.downloads.onChanged.removeListener(onChanged);
      updateTunebatButton(buttonEl, { fileUrl, filename });
    } else if (delta.state && delta.state.current === "interrupted") {
      chrome.downloads.onChanged.removeListener(onChanged);
    }
  }
  chrome.downloads.onChanged.addListener(onChanged);
}

function updateTunebatButton(buttonEl, downloadedFile) {
  if (!downloadedFile) return;
  buttonEl.dataset.fileUrl = downloadedFile.fileUrl;
  buttonEl.dataset.filename = downloadedFile.filename;
  buttonEl.classList.remove("hidden");
}

function makeTunebatHandler(buttonEl, progressEl) {
  return async function handleTunebatClick() {
    const fileUrl = buttonEl.dataset.fileUrl;
    const filename = buttonEl.dataset.filename;

    if (!fileUrl) {
      chrome.tabs.create({ url: TUNEBAT_URL });
      return;
    }

    const originalLabel = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "Opening Tunebat...";

    const response = await chrome.runtime.sendMessage({ type: "openInTunebat", fileUrl, filename });

    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;

    if (!response?.ok) {
      progressEl.classList.remove("hidden");
      progressEl.textContent = `Error opening Tunebat: ${response?.error || "unknown error"}`;
    }
  };
}

function getCachedBundle(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(`bundle:${key}`, (items) => {
      resolve(items[`bundle:${key}`] || null);
    });
  });
}

function setCachedBundle(key, bundle) {
  chrome.storage.local.set({ [`bundle:${key}`]: bundle });
}

const TAB_NAMES = ["file", "link", "sample", "settings"];

async function setupTabs() {
  els.tabFile.addEventListener("click", () => switchTab("file"));
  els.tabLink.addEventListener("click", () => switchTab("link"));
  els.tabSample.addEventListener("click", () => switchTab("sample"));
  els.tabSettings.addEventListener("click", () => switchTab("settings"));

  // Remember whichever tab was open last, so reopening the popup lands back on it.
  const stored = await chrome.storage.local.get("activeTab");
  switchTab(TAB_NAMES.includes(stored.activeTab) ? stored.activeTab : "link");
}

function switchTab(which) {
  const tabs = { file: els.tabFile, link: els.tabLink, sample: els.tabSample, settings: els.tabSettings };
  const panels = { file: els.panelFile, link: els.panelLink, sample: els.panelSample, settings: els.panelSettings };
  for (const name of TAB_NAMES) {
    const isActive = name === which;
    tabs[name].classList.toggle("active", isActive);
    panels[name].classList.toggle("hidden", !isActive);
  }
  chrome.storage.local.set({ activeTab: which });
}

// --- File tab: pick/drop a local audio file, then convert it or analyze it on Tunebat ---
// The file is copied to the local server once (POST /api/stash) the first time it's needed
// and reused for every conversion after that. It has to go through the server for Tunebat
// too: the popup closes the moment the Tunebat tab opens, so the background worker fetches
// the bytes by URL instead.

const FILE_EXTS = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "aiff", "aif", "opus"]; // /api/stash whitelist
const TUNEBAT_EXTS = ["mp3", "wav", "flac", "aac", "ogg", "m4a"]; // what Tunebat's uploader accepts
const FILE_MAX_BYTES = 100 * 1024 * 1024; // matches the server's /api/stash limit
let selectedFile = null;
let stash = null; // server copy of selectedFile: { name, url } — null until first upload

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function fileBaseName(name) {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[\\/:*?"<>|]/g, "_");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setFileMessage(message) {
  els.fileProgress.textContent = message;
  els.fileProgress.classList.toggle("hidden", !message);
}

function describeError(err) {
  return err instanceof TypeError
    ? "Can't reach the local server. Is it running?"
    : `Error: ${err.message}`;
}

function initFileTab() {
  const openPicker = () => els.fileInput.click();
  els.fileDropzone.addEventListener("click", openPicker);
  els.fileDropzone.addEventListener("keydown", (e) => {
    if (e.target !== els.fileDropzone) return; // ignore keys pressed on the inner clear button
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  els.fileInput.addEventListener("change", () => {
    selectFile(els.fileInput.files[0]);
    els.fileInput.value = ""; // lets picking the same file again fire "change"
  });

  els.fileClear.addEventListener("click", (e) => {
    e.stopPropagation(); // don't also open the picker
    selectFile(null);
  });

  // Drag & drop. The popup is a normal page, so a file dropped anywhere outside
  // the zone would navigate the popup to the file — block that everywhere.
  els.fileDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.fileDropzone.classList.add("dragover");
  });
  els.fileDropzone.addEventListener("dragleave", () => els.fileDropzone.classList.remove("dragover"));
  els.fileDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.fileDropzone.classList.remove("dragover");
    selectFile(e.dataTransfer.files[0]);
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());

  const openTunebat = makeTunebatHandler(els.btnFileTunebat, els.fileProgress);
  els.btnFileTunebat.addEventListener("click", async () => {
    if (!selectedFile) return;
    if (!els.btnFileTunebat.dataset.fileUrl && !(await prepareTunebatFile())) return;
    openTunebat();
  });
}

function selectFile(file) {
  setFileMessage("");
  stash = null;
  delete els.btnFileTunebat.dataset.fileUrl;
  delete els.btnFileTunebat.dataset.filename;

  if (file) {
    if (!FILE_EXTS.includes(fileExtension(file.name))) {
      file = null;
      setFileMessage("Unsupported file. Use MP3, WAV, FLAC, AIFF, M4A, AAC, OGG or OPUS.");
    } else if (file.size > FILE_MAX_BYTES) {
      file = null;
      setFileMessage("File is too large (100 MB max).");
    }
  }

  selectedFile = file;
  els.fileDropzone.classList.toggle("has-file", !!file);
  els.fileClear.classList.toggle("hidden", !file);
  // Nothing to convert or analyze until a file is chosen.
  els.fileFormatOptions.classList.toggle("hidden", !file);
  els.btnFileTunebat.classList.toggle("hidden", !file);
  els.fileDropzoneTitle.textContent = file ? file.name : "Drop an audio file here";
  els.fileDropzoneSub.textContent = file
    ? `${formatBytes(file.size)} · click to choose another`
    : "or click to browse";
  els.fileDropzoneFormats.classList.toggle("hidden", !!file);
}

// Uploads the selected file to the local server (once per selection).
async function ensureStash() {
  if (stash) return stash;
  const file = selectedFile;
  const res = await fetch(`${SERVER}/api/stash?ext=${fileExtension(file.name)}`, {
    method: "POST",
    body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Unknown error.");
  if (file !== selectedFile) throw new Error("The selected file changed — try again.");
  stash = { name: data.filename, url: `${SERVER}${data.downloadUrl}` };
  return stash;
}

async function convertStash(format, loudnorm) {
  const res = await fetch(`${SERVER}/api/convert-stash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stash: stash.name, format, loudnorm }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Unknown error.");
  return { url: `${SERVER}${data.downloadUrl}`, filename: data.filename };
}

async function handleFileConvert(format) {
  if (!selectedFile) return;
  const file = selectedFile;
  fileGrid.setBusy(format);
  els.btnFileTunebat.disabled = true;
  try {
    if (!stash) setFileMessage("Uploading…");
    await ensureStash();
    setFileMessage("Converting…");
    const converted = await convertStash(format, await getLoudnormSetting());

    await chrome.downloads.download({
      url: converted.url,
      filename: `${fileBaseName(file.name)}.${format}`,
      saveAs: false,
    });
    setFileMessage("Download started — check Chrome's downloads bar.");
  } catch (err) {
    setFileMessage(describeError(err));
  } finally {
    fileGrid.setBusy(null);
    els.btnFileTunebat.disabled = false;
  }
}

// Points the Tunebat button at a file Tunebat will accept: the stashed copy as-is, or —
// for types its uploader rejects (AIFF, OPUS) — a WAV made from it first (never
// normalized: this is just a container change so the analysis sees the original audio).
async function prepareTunebatFile() {
  const button = els.btnFileTunebat;
  const originalLabel = button.textContent;
  const file = selectedFile;
  button.disabled = true;
  fileGrid.setBusy(""); // dims the format buttons too (no id matches, so none spins)
  try {
    button.textContent = "Uploading…";
    await ensureStash();
    if (TUNEBAT_EXTS.includes(fileExtension(file.name))) {
      button.dataset.fileUrl = stash.url;
      button.dataset.filename = file.name;
    } else {
      button.textContent = "Converting…";
      const converted = await convertStash("wav", false);
      button.dataset.fileUrl = converted.url;
      button.dataset.filename = `${fileBaseName(file.name)}.wav`;
    }
    return true;
  } catch (err) {
    setFileMessage(describeError(err));
    return false;
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
    fileGrid.setBusy(null);
  }
}

// --- Sample tab: record the audio playing in the current tab ---
// Recording itself runs in an offscreen document coordinated by background.js, so
// it keeps going even if this popup closes. This just reflects that state.

let sampleTimerInterval = null;
let sampleElapsedBaseMs = 0;
let sampleElapsedStartedAt = 0;
let lastSampleBlob = null;

function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

async function initSampleTab() {
  els.sampleRecordBtn.addEventListener("click", handleRecordClick);
  els.sampleBtnDiscard.addEventListener("click", handleDiscardRecording);
  els.sampleBtnTunebat.addEventListener("click", makeTunebatHandler(els.sampleBtnTunebat, els.sampleProgress));
  setupSamplePlayer();

  // Live level meter while recording: offscreen.js broadcasts a volume reading a
  // few times a second (see background.js/offscreen.js) — just reflect it here.
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "sample:level") return;
    if (!els.sampleRecordBtn.classList.contains("recording")) return;
    const pct = Math.min(100, Math.round(message.level * 220));
    els.sampleLevelFill.style.width = `${pct}%`;
  });

  const status = await sendToBackground({ type: "sample:status" });
  if (status?.recording) {
    enterRecordingUI(status.elapsedMs);
    return;
  }

  if (status?.hasLastRecording) {
    const last = await sendToBackground({ type: "sample:getLast" });
    if (last?.recording) {
      showSampleResult(last.recording.audioBase64, last.recording.durationMs);
      const bundle = await getCachedBundle("__sample__");
      updateTunebatButton(els.sampleBtnTunebat, bundle?.downloadedFile);
    }
  }
}

async function handleRecordClick() {
  if (els.sampleRecordBtn.classList.contains("recording")) {
    await stopSampleRecordingFlow();
  } else {
    await startSampleRecordingFlow();
  }
}

async function startSampleRecordingFlow() {
  els.sampleRecordBtn.disabled = true;
  els.sampleStatus.textContent = "Starting…";
  try {
    const res = await sendToBackground({ type: "sample:start" });
    if (!res?.ok) throw new Error(res?.error || "Could not start recording.");
    els.sampleResult.classList.add("hidden");
    enterRecordingUI(0);
  } catch (err) {
    els.sampleStatus.textContent = `Error: ${err.message}`;
  } finally {
    els.sampleRecordBtn.disabled = false;
  }
}

async function stopSampleRecordingFlow() {
  els.sampleRecordBtn.disabled = true;
  els.sampleStatus.textContent = "Stopping…";
  try {
    const res = await sendToBackground({ type: "sample:stop" });
    if (!res?.ok) throw new Error(res?.error || "Could not stop recording.");
    exitRecordingUI();
    showSampleResult(res.audioBase64, res.durationMs);
  } catch (err) {
    els.sampleStatus.textContent = `Error: ${err.message}`;
    exitRecordingUI();
  } finally {
    els.sampleRecordBtn.disabled = false;
  }
}

function enterRecordingUI(elapsedMs) {
  els.sampleRecordBtn.classList.add("recording");
  els.tabSample.classList.add("has-activity");
  els.sampleTimer.classList.remove("hidden");
  els.sampleLevelMeter.classList.remove("hidden");
  els.sampleLevelFill.style.width = "0%";
  els.sampleStatus.textContent = "Recording…";

  sampleElapsedBaseMs = elapsedMs;
  sampleElapsedStartedAt = Date.now();
  els.sampleTimer.textContent = formatTimer(sampleElapsedBaseMs);

  clearInterval(sampleTimerInterval);
  sampleTimerInterval = setInterval(() => {
    const elapsed = sampleElapsedBaseMs + (Date.now() - sampleElapsedStartedAt);
    els.sampleTimer.textContent = formatTimer(elapsed);
  }, 250);
}

function exitRecordingUI() {
  els.sampleRecordBtn.classList.remove("recording");
  els.tabSample.classList.remove("has-activity");
  els.sampleTimer.classList.add("hidden");
  els.sampleLevelMeter.classList.add("hidden");
  clearInterval(sampleTimerInterval);
  sampleTimerInterval = null;
  els.sampleStatus.textContent = "Record the audio playing in this tab.";
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function defaultSampleFilename() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return `Sample ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

// Waveform + playback are combined into one canvas: peaks are computed once
// after decoding, then re-rendered on every playback tick with a "played" vs
// "unplayed" color split (like most audio-editor waveform players).
let waveformPeaks = null;

// The canvas is laid out at a fixed CSS size (popup body is 320px wide minus padding);
// its backing store is scaled by devicePixelRatio so it stays crisp on retina screens.
// Sizes are constants (not measured) because the panel may be hidden when this runs.
const WAVEFORM_CSS_WIDTH = 288;
const WAVEFORM_CSS_HEIGHT = 56;

async function computeWaveformPeaks(blob) {
  const canvas = els.sampleWaveform;
  try {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(WAVEFORM_CSS_WIDTH * dpr);
    canvas.height = Math.round(WAVEFORM_CSS_HEIGHT * dpr);

    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    audioCtx.close();

    const width = canvas.width;
    const samplesPerPixel = Math.max(1, Math.floor(channelData.length / width));
    const peaks = [];
    for (let x = 0; x < width; x++) {
      let min = 1.0;
      let max = -1.0;
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);
      for (let i = start; i < end; i++) {
        const v = channelData[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks.push([min, max]);
    }
    waveformPeaks = peaks;
    renderWaveform(0);
  } catch (err) {
    // Waveform is a nice-to-have; failing to draw it shouldn't block playback/download.
    console.error("Waveform draw failed:", err);
  }
}

// Trim handles: drag the edges of the waveform to cut the clip before export.
// Playback loops within [trimStart, trimEnd] so you can preview the trimmed
// result; the actual cut happens server-side (ffmpeg -ss/-to) on download.
let trimStart = 0;
let trimEnd = 0;
let sampleDurationSec = 0;
let draggingHandle = null; // "start" | "end" | null

function timeToX(t, width) {
  return sampleDurationSec ? (t / sampleDurationSec) * width : 0;
}

function xToTime(x, width) {
  if (!sampleDurationSec) return 0;
  return Math.max(0, Math.min(sampleDurationSec, (x / width) * sampleDurationSec));
}

function renderWaveform(progress) {
  if (!waveformPeaks) return;
  const canvas = els.sampleWaveform;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const mid = height / 2;
  const playedX = Math.floor(progress * width);

  ctx.clearRect(0, 0, width, height);
  for (let x = 0; x < width; x++) {
    const [min, max] = waveformPeaks[x];
    const y1 = mid + min * mid * 0.9;
    const y2 = mid + max * mid * 0.9;
    ctx.fillStyle = x < playedX ? "#6c5ce7" : "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }

  if (sampleDurationSec > 0) {
    const startX = timeToX(trimStart, width);
    const endX = timeToX(trimEnd, width);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    if (startX > 0) ctx.fillRect(0, 0, startX, height);
    if (endX < width) ctx.fillRect(endX, 0, width - endX, height);

    const handleW = Math.max(2, Math.round(2 * (window.devicePixelRatio || 1)));
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.max(0, startX - handleW / 2), 0, handleW, height);
    ctx.fillRect(Math.min(width - handleW, endX - handleW / 2), 0, handleW, height);
  }
}

const TRIM_HANDLE_HIT_PX = 8;

function setupSamplePlayer() {
  els.samplePlayBtn.addEventListener("click", () => {
    if (els.sampleAudio.paused) {
      if (els.sampleAudio.currentTime < trimStart || els.sampleAudio.currentTime >= trimEnd) {
        els.sampleAudio.currentTime = trimStart;
      }
      els.sampleAudio.play();
    } else {
      els.sampleAudio.pause();
    }
  });
  let playheadFrame = null;
  els.sampleAudio.addEventListener("play", () => {
    els.samplePlayBtn.classList.add("playing");
    // "timeupdate" only fires ~4x/second, which makes the playhead visibly step;
    // while playing, redraw every animation frame instead.
    const loop = () => {
      syncPlayhead();
      if (!els.sampleAudio.paused) playheadFrame = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(playheadFrame);
    playheadFrame = requestAnimationFrame(loop);
  });
  els.sampleAudio.addEventListener("pause", () => {
    els.samplePlayBtn.classList.remove("playing");
    cancelAnimationFrame(playheadFrame);
  });
  els.sampleAudio.addEventListener("loadedmetadata", () => {
    sampleDurationSec = els.sampleAudio.duration || 0;
    trimStart = 0;
    trimEnd = sampleDurationSec;
    renderWaveform(0);
  });
  els.sampleAudio.addEventListener("ended", () => {
    els.samplePlayBtn.classList.remove("playing");
    renderWaveform(0);
  });
  function syncPlayhead() {
    if (!els.sampleAudio.duration) return;
    if (trimEnd > 0 && els.sampleAudio.currentTime >= trimEnd) {
      els.sampleAudio.pause();
      els.sampleAudio.currentTime = trimStart;
      renderWaveform(trimStart / els.sampleAudio.duration);
      return;
    }
    renderWaveform(els.sampleAudio.currentTime / els.sampleAudio.duration);
  }
  els.sampleAudio.addEventListener("timeupdate", syncPlayhead); // covers seeking while paused

  els.sampleWaveform.addEventListener("mousedown", (e) => {
    if (!sampleDurationSec) return;
    const rect = els.sampleWaveform.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startX = timeToX(trimStart, rect.width);
    const endX = timeToX(trimEnd, rect.width);

    if (Math.abs(x - startX) <= TRIM_HANDLE_HIT_PX) {
      draggingHandle = "start";
    } else if (Math.abs(x - endX) <= TRIM_HANDLE_HIT_PX) {
      draggingHandle = "end";
    } else {
      draggingHandle = null;
      const fraction = x / rect.width;
      els.sampleAudio.currentTime = fraction * sampleDurationSec;
    }
  });
  els.sampleWaveform.addEventListener("dblclick", () => {
    trimStart = 0;
    trimEnd = sampleDurationSec;
    renderWaveform(els.sampleAudio.duration ? els.sampleAudio.currentTime / els.sampleAudio.duration : 0);
  });
  document.addEventListener("mousemove", (e) => {
    if (!draggingHandle) return;
    const rect = els.sampleWaveform.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const t = xToTime(x, rect.width);
    if (draggingHandle === "start") {
      trimStart = Math.max(0, Math.min(t, trimEnd - 0.1));
    } else {
      trimEnd = Math.min(sampleDurationSec, Math.max(t, trimStart + 0.1));
    }
    renderWaveform(els.sampleAudio.duration ? els.sampleAudio.currentTime / els.sampleAudio.duration : 0);
  });
  document.addEventListener("mouseup", () => {
    draggingHandle = null;
  });
}

function showSampleResult(audioBase64, durationMs) {
  lastSampleBlob = base64ToBlob(audioBase64, "audio/webm");
  els.sampleAudio.src = URL.createObjectURL(lastSampleBlob);
  els.sampleAudio.pause();
  els.samplePlayBtn.classList.remove("playing");
  els.sampleResult.classList.remove("hidden");
  els.sampleFilename.value = defaultSampleFilename();

  const durationLabel = typeof durationMs === "number" ? ` (${formatTimer(durationMs)})` : "";
  els.sampleStatus.textContent = `Recording ready${durationLabel}.`;

  computeWaveformPeaks(lastSampleBlob);
}

async function handleSampleDownload(format) {
  if (!lastSampleBlob) return;

  sampleGrid.setBusy(format);
  els.sampleProgress.classList.remove("hidden");
  els.sampleProgress.textContent = "Converting and downloading...";

  try {
    // Sends the raw recorded bytes directly (not JSON+base64) — cheaper for a
    // several-MB recording, and reuses the Blob we already built for playback.
    // Only send trim bounds if the user actually moved a handle — otherwise let
    // the server skip trimming instead of re-encoding the exact same range.
    let trimParams = "";
    if (sampleDurationSec > 0 && (trimStart > 0.05 || trimEnd < sampleDurationSec - 0.05)) {
      trimParams = `&trimStart=${trimStart.toFixed(2)}&trimEnd=${trimEnd.toFixed(2)}`;
    }
    const loudnorm = await getLoudnormSetting();
    const res = await fetch(
      `${SERVER}/api/upload-convert?format=${format}&sourceExt=webm&loudnorm=${loudnorm}${trimParams}`,
      { method: "POST", body: lastSampleBlob }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    const safeName =
      (els.sampleFilename.value || "sample").trim().replace(/[\\/:*?"<>|]/g, "_") || "sample";
    const filename = `${safeName}.${format}`;
    const fileUrl = `${SERVER}${data.downloadUrl}`;

    const downloadId = await chrome.downloads.download({
      url: fileUrl,
      filename,
      saveAs: false,
    });

    els.sampleProgress.textContent = "Download started — check Chrome's downloads bar.";
    trackDownloadCompletion(downloadId, fileUrl, filename, els.sampleBtnTunebat, "__sample__");
  } catch (err) {
    els.sampleProgress.textContent = `Error: ${err.message}`;
  } finally {
    sampleGrid.setBusy(null);
  }
}

async function handleDiscardRecording() {
  await sendToBackground({ type: "sample:discard" });
  lastSampleBlob = null;
  waveformPeaks = null;
  trimStart = 0;
  trimEnd = 0;
  sampleDurationSec = 0;
  els.sampleResult.classList.add("hidden");
  els.sampleAudio.pause();
  els.sampleAudio.removeAttribute("src");
  els.samplePlayBtn.classList.remove("playing");
  els.sampleFilename.value = "";
  els.sampleWaveform.getContext("2d").clearRect(0, 0, els.sampleWaveform.width, els.sampleWaveform.height);
  els.sampleBtnTunebat.classList.add("hidden");
  delete els.sampleBtnTunebat.dataset.fileUrl;
  delete els.sampleBtnTunebat.dataset.filename;
  els.sampleStatus.textContent = "Record the audio playing in this tab.";
}

// --- Settings tab ---

function getLoudnormSetting() {
  return new Promise((resolve) => {
    chrome.storage.local.get("settings.loudnorm", (items) => {
      resolve(items["settings.loudnorm"] !== false); // default: on
    });
  });
}

async function initSettingsTab() {
  const enabled = await getLoudnormSetting();
  els.settingLoudnorm.checked = enabled;
  els.settingLoudnorm.addEventListener("change", () => {
    chrome.storage.local.set({ "settings.loudnorm": els.settingLoudnorm.checked });
  });

  els.settingsBtnRecheck.addEventListener("click", updateSettingsServerStatus);
  updateSettingsServerStatus();

  els.settingsBtnClearCache.addEventListener("click", handleClearCache);
}

async function updateSettingsServerStatus() {
  els.settingsServerText.textContent = "Checking server…";
  try {
    const res = await fetch(`${SERVER}/health`);
    if (!res.ok) throw new Error();
    els.settingsServerText.textContent = `Connected — ${SERVER}`;
  } catch {
    els.settingsServerText.textContent = "Not connected — start the server (server && npm start)";
  }
}

async function handleClearCache() {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter((k) => !k.startsWith("settings."));
  if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);

  const original = els.settingsBtnClearCache.textContent;
  els.settingsBtnClearCache.textContent = "Cleared!";
  setTimeout(() => {
    els.settingsBtnClearCache.textContent = original;
  }, 1500);
}

main();
