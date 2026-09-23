const SERVER = "http://127.0.0.1:5177";
const TUNEBAT_URL = "https://tunebat.com/Analyzer";

const els = {
  statusMessage: document.getElementById("status-message"),
  trackInfo: document.getElementById("track-info"),
  thumbnail: document.getElementById("thumbnail"),
  trackTitle: document.getElementById("track-title"),
  trackMeta: document.getElementById("track-meta"),
  formatOptions: document.getElementById("format-options"),
  btnMp3: document.getElementById("btn-mp3"),
  btnWav: document.getElementById("btn-wav"),
  progress: document.getElementById("progress"),
  serverDot: document.getElementById("server-status"),
  btnTunebat: document.getElementById("btn-tunebat"),
  tabLink: document.getElementById("tab-link"),
  tabSample: document.getElementById("tab-sample"),
  panelLink: document.getElementById("panel-link"),
  panelSample: document.getElementById("panel-sample"),
  sampleStatus: document.getElementById("sample-status"),
  sampleResult: document.getElementById("sample-result"),
  sampleAudio: document.getElementById("sample-audio"),
  sampleBtnMp3: document.getElementById("sample-btn-mp3"),
  sampleBtnWav: document.getElementById("sample-btn-wav"),
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
};

let currentCacheKey = null;

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
  await setupTabs();
  initSampleTab();
  initSettingsTab();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
  els.thumbnail.removeAttribute("src");
  els.trackTitle.textContent = "Loading…";
  els.trackTitle.classList.add("placeholder");
  els.trackMeta.textContent = "";

  els.formatOptions.classList.remove("hidden");
  els.btnMp3.classList.add("loading");
  els.btnWav.classList.add("loading");
  els.btnMp3.disabled = true;
  els.btnWav.disabled = true;
}

async function handleDirect(url) {
  try {
    const res = await fetch(`${SERVER}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
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
      body: JSON.stringify({ url: spotifyUrl }),
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
  els.trackInfo.classList.remove("hidden");
  els.thumbnail.src = data.thumbnail || "";
  els.trackTitle.textContent = data.title || "Untitled";
  els.trackTitle.classList.remove("placeholder");
  els.trackMeta.textContent = [data.uploader, formatDuration(data.duration)]
    .filter(Boolean)
    .join(" · ");

  els.formatOptions.classList.remove("hidden");
  els.btnMp3.classList.remove("loading");
  els.btnWav.classList.remove("loading");
  els.btnMp3.disabled = false;
  els.btnWav.disabled = false;
  els.btnMp3.addEventListener("click", () => handleDownload(mediaUrl, "mp3", data.title));
  els.btnWav.addEventListener("click", () => handleDownload(mediaUrl, "wav", data.title));
}

async function handleDownload(url, format, title) {
  els.btnMp3.disabled = true;
  els.btnWav.disabled = true;
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

    const safeTitle = (title || "instrumental").replace(/[\\/:*?"<>|]/g, "_");
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
    els.btnMp3.disabled = false;
    els.btnWav.disabled = false;
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

const TAB_NAMES = ["link", "sample", "settings"];

async function setupTabs() {
  els.tabLink.addEventListener("click", () => switchTab("link"));
  els.tabSample.addEventListener("click", () => switchTab("sample"));
  els.tabSettings.addEventListener("click", () => switchTab("settings"));

  // Remember whichever tab was open last, so reopening the popup lands back on it.
  const stored = await chrome.storage.local.get("activeTab");
  switchTab(TAB_NAMES.includes(stored.activeTab) ? stored.activeTab : "link");
}

function switchTab(which) {
  const tabs = { link: els.tabLink, sample: els.tabSample, settings: els.tabSettings };
  const panels = { link: els.panelLink, sample: els.panelSample, settings: els.panelSettings };
  for (const name of TAB_NAMES) {
    const isActive = name === which;
    tabs[name].classList.toggle("active", isActive);
    panels[name].classList.toggle("hidden", !isActive);
  }
  chrome.storage.local.set({ activeTab: which });
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
  els.sampleBtnMp3.addEventListener("click", () => handleSampleDownload("mp3"));
  els.sampleBtnWav.addEventListener("click", () => handleSampleDownload("wav"));
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

async function computeWaveformPeaks(audioBase64) {
  const canvas = els.sampleWaveform;
  try {
    const blob = base64ToBlob(audioBase64, "audio/webm");
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

    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.max(0, startX - 1), 0, 2, height);
    ctx.fillRect(Math.min(width - 2, endX - 1), 0, 2, height);
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
  els.sampleAudio.addEventListener("play", () => els.samplePlayBtn.classList.add("playing"));
  els.sampleAudio.addEventListener("pause", () => els.samplePlayBtn.classList.remove("playing"));
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
  els.sampleAudio.addEventListener("timeupdate", () => {
    if (!els.sampleAudio.duration) return;
    if (trimEnd > 0 && els.sampleAudio.currentTime >= trimEnd) {
      els.sampleAudio.pause();
      els.sampleAudio.currentTime = trimStart;
      renderWaveform(trimStart / els.sampleAudio.duration);
      return;
    }
    renderWaveform(els.sampleAudio.currentTime / els.sampleAudio.duration);
  });

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

  computeWaveformPeaks(audioBase64);
}

async function handleSampleDownload(format) {
  if (!lastSampleBlob) return;

  els.sampleBtnMp3.disabled = true;
  els.sampleBtnWav.disabled = true;
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
    els.sampleBtnMp3.disabled = false;
    els.sampleBtnWav.disabled = false;
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
