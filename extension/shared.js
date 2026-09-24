// Shared by the popup (popup.html loads it first) and the background service worker
// (background.js importScripts() it): settings, file naming, history storage and the
// download helper — everything both sides must agree on. Plain globals, no DOM access.

const SERVER = "http://127.0.0.1:5177";

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

// Popup tabs the user can hide in Settings (Settings itself is always there). `side` is where the
// tab sits in the header: the left ones can also be reordered, History sits on the right by Settings.
const TABS = [
  { id: "link", label: "Link", side: "left" },
  { id: "file", label: "File", side: "left" },
  { id: "sample", label: "Sample", side: "left" },
  { id: "history", label: "History", side: "right" },
];

// Building blocks for downloaded file names (Settings > File name). `example` feeds the
// live preview. Missing values (no BPM before the analysis, no producer for a recording)
// are simply skipped.
const NAME_BLOCKS = [
  { id: "title", label: "Beat name", example: "Midnight Drive" },
  { id: "bpm", label: "BPM", example: "140bpm" },
  { id: "key", label: "Key", example: "Am" },
  { id: "producer", label: "Producer", example: "Beatmaker" },
  { id: "date", label: "Date", example: "2026-09-25" },
  { id: "format", label: "Format", example: "MP3" },
  { id: "custom", label: "Custom text", example: "FREE" },
];
const DEFAULT_NAME_BLOCKS = ["title", "bpm", "key", "producer"];
// How BPM and key are written into names (Settings > File names).
const BPM_STYLES = [
  { value: "suffix", label: "140bpm", format: (n) => `${n}bpm` },
  { value: "spaced", label: "140 BPM", format: (n) => `${n} BPM` },
  { value: "plain", label: "140", format: (n) => String(n) },
];
const KEY_STYLES = [
  { value: "short", label: "Am · F#" },
  { value: "long", label: "A minor · F# major" },
];
const NAME_SEPARATORS = [
  { value: " - ", label: "Beat - 140bpm" },
  { value: "_", label: "Beat_140bpm" },
  { value: " ", label: "Beat 140bpm" },
  { value: " | ", label: "Beat | 140bpm" },
];

const QUEUE_KEY = "queue"; // download queue (see queue-engine.js / tab-link.js)
const HISTORY_KEY = "history";
const HISTORY_MAX = 30;
const ANALYSIS_JOBS_KEY = "analysisJobs"; // pending Tunebat analyses (see analysis-engine.js)
const FILE_ANALYSIS_PREFIX = "analysisFile:"; // + server file URL: result for a File-tab file, before any conversion

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// The popup and the worker both write the history; Web Locks (same origin, shared across
// contexts) keep two read-modify-writes from overwriting each other.
function withHistoryLock(work) {
  return navigator.locks.request("history", work);
}

async function loadHistory() {
  const items = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(items[HISTORY_KEY]) ? items[HISTORY_KEY] : [];
}

// Called by startDownload() for every download that was actually started.
function recordHistory(entry) {
  return withHistoryLock(async () => {
    const list = await loadHistory();
    list.unshift({ ...entry, ts: Date.now() });
    await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, HISTORY_MAX) });
  });
}

function updateHistory(id, patch) {
  return withHistoryLock(async () => {
    const list = await loadHistory();
    const entry = list.find((e) => e.id === id);
    if (!entry) return;
    Object.assign(entry, patch);
    await chrome.storage.local.set({ [HISTORY_KEY]: list });
  });
}

const SETTING_KEYS = {
  normalizeLink: "settings.normalize.link",
  normalizeSample: "settings.normalize.sample",
  normalizeFile: "settings.normalize.file",
  targetLufs: "settings.targetLufs",
  saveAs: "settings.saveAs",
  subfolder: "settings.subfolder",
  startTab: "settings.startTab",
  prefetch: "settings.prefetch",
  formats: "settings.formats",
  tags: "settings.tags",
  nameBlocks: "settings.nameBlocks",
  nameSeparator: "settings.nameSeparator",
  nameCustom: "settings.nameCustom",
  tabOrder: "settings.tabOrder",
  tabsHidden: "settings.tabsHidden",
  analyzeLink: "settings.analyze.link",
  analyzeSample: "settings.analyze.sample",
  analyzeFile: "settings.analyze.file",
  bpmStyle: "settings.bpmStyle",
  keyStyle: "settings.keyStyle",
  deleteOriginal: "settings.deleteOriginal",
  closeTunebatTab: "settings.closeTunebatTab",
  queueConcurrency: "settings.queueConcurrency",
  autoUpdateCheck: "settings.autoUpdateCheck",
};
const LEGACY_NORMALIZE_KEY = "settings.loudnorm"; // single toggle from before there was one per category
const LEGACY_ANALYZE_KEY = "settings.analyze"; // ditto for the Tunebat analysis

// All settings with their defaults applied. Link/Sample normalize by default (as they
// always did); File conversions don't — converting a file shouldn't change its level
// unless asked to.
async function getSettings() {
  const items = await chrome.storage.local.get([...Object.values(SETTING_KEYS), LEGACY_NORMALIZE_KEY, LEGACY_ANALYZE_KEY]);
  const legacy = items[LEGACY_NORMALIZE_KEY];
  const legacyAnalyze = items[LEGACY_ANALYZE_KEY];
  const tabOrder = validTabOrder(items[SETTING_KEYS.tabOrder]);
  const hidden = Array.isArray(items[SETTING_KEYS.tabsHidden]) ? items[SETTING_KEYS.tabsHidden] : [];
  const visibleTabs = tabOrder.filter((id) => !hidden.includes(id));
  return {
    normalize: {
      link: items[SETTING_KEYS.normalizeLink] ?? legacy ?? true,
      sample: items[SETTING_KEYS.normalizeSample] ?? legacy ?? true,
      file: items[SETTING_KEYS.normalizeFile] ?? false,
    },
    targetLufs: Number(items[SETTING_KEYS.targetLufs]) || -16,
    saveAs: items[SETTING_KEYS.saveAs] ?? false,
    subfolder: items[SETTING_KEYS.subfolder] ?? "",
    startTab: items[SETTING_KEYS.startTab] ?? "last",
    prefetch: items[SETTING_KEYS.prefetch] ?? true,
    formats: validFormatIds(items[SETTING_KEYS.formats]),
    tags: items[SETTING_KEYS.tags] ?? true,
    nameBlocks: validNameBlocks(items[SETTING_KEYS.nameBlocks]),
    nameSeparator: NAME_SEPARATORS.some((s) => s.value === items[SETTING_KEYS.nameSeparator]) ? items[SETTING_KEYS.nameSeparator] : " - ",
    nameCustom: items[SETTING_KEYS.nameCustom] ?? "",
    tabOrder,
    visibleTabs: visibleTabs.length ? visibleTabs : [tabOrder[0]], // never zero tabs
    // Tunebat analysis per source: downloads from a link, exported recordings, and files
    // dropped in the File tab (analyzed the moment they're added).
    analyze: {
      link: items[SETTING_KEYS.analyzeLink] ?? legacyAnalyze ?? true,
      sample: items[SETTING_KEYS.analyzeSample] ?? legacyAnalyze ?? true,
      file: items[SETTING_KEYS.analyzeFile] ?? legacyAnalyze ?? true,
    },
    bpmStyle: BPM_STYLES.some((b) => b.value === items[SETTING_KEYS.bpmStyle]) ? items[SETTING_KEYS.bpmStyle] : "suffix",
    keyStyle: KEY_STYLES.some((k) => k.value === items[SETTING_KEYS.keyStyle]) ? items[SETTING_KEYS.keyStyle] : "short",
    deleteOriginal: items[SETTING_KEYS.deleteOriginal] ?? true,
    closeTunebatTab: items[SETTING_KEYS.closeTunebatTab] ?? true,
    autoUpdateCheck: items[SETTING_KEYS.autoUpdateCheck] ?? true,
    queueConcurrency: [1, 2, 3].includes(Number(items[SETTING_KEYS.queueConcurrency])) ? Number(items[SETTING_KEYS.queueConcurrency]) : 2,
  };
}

// Saved list of visible formats, cleaned up: unknown ids dropped, never empty.
function validFormatIds(saved) {
  const all = FORMATS.map((f) => f.id);
  const ids = Array.isArray(saved) ? all.filter((id) => saved.includes(id)) : all;
  return ids.length ? ids : all;
}

// Saved tab order, cleaned up: unknown ids dropped, missing ones appended, right-side tabs last.
function validTabOrder(saved) {
  const all = TABS.map((t) => t.id);
  const kept = Array.isArray(saved) ? saved.filter((id, i) => all.includes(id) && saved.indexOf(id) === i) : [];
  const order = [...kept, ...all.filter((id) => !kept.includes(id))];
  const side = (id) => TABS.find((t) => t.id === id).side;
  return [...order.filter((id) => side(id) === "left"), ...order.filter((id) => side(id) !== "left")]; // History (right side) last
}

// Saved name blocks, cleaned up: known ids only, no repeats, never empty.
function validNameBlocks(saved) {
  const known = NAME_BLOCKS.map((b) => b.id);
  const blocks = Array.isArray(saved) ? saved.filter((id, i) => known.includes(id) && saved.indexOf(id) === i) : [];
  return blocks.length ? blocks : [...DEFAULT_NAME_BLOCKS];
}

// What the server needs to know about volume normalization for one category.
async function getNormalizeOptions(category) {
  const settings = await getSettings();
  return {
    loudnorm: settings.normalize[category],
    targetLufs: settings.targetLufs,
    // Tags + cover art are written by the server for Link downloads only (it has the info).
    ...(category === "link" ? { tags: settings.tags } : {}),
  };
}

// Options sent with an analyze request: the server prepares MP3 + WAV in the background
// right away, so it needs to know how they'll be processed (and whether to do it at all).
async function getAnalyzeOptions() {
  const settings = await getSettings();
  return {
    loudnorm: settings.normalize.link,
    targetLufs: settings.targetLufs,
    tags: settings.tags,
    prefetch: settings.prefetch,
  };
}

// "A minor" -> "Am", "F# major" -> "F#", "B♭ minor" -> "Bbm" (short form for file names).
function shortKey(key) {
  const match = String(key || "").trim().match(/^([A-G])\s*([#♯b♭]?)\s*(major|minor)$/i);
  if (!match) return "";
  const accidental = match[2].replace("♯", "#").replace("♭", "b");
  return `${match[1].toUpperCase()}${accidental}${match[3].toLowerCase() === "minor" ? "m" : ""}`;
}

// The text of each name block for one file. `values`: title, producer, format, and — once
// the Tunebat analysis is in — bpm (number) and key ("A minor").
function nameBlockValues(values, settings) {
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const bpmStyle = BPM_STYLES.find((b) => b.value === settings.bpmStyle) || BPM_STYLES[0];
  return {
    title: values.title || "",
    producer: values.producer || "",
    bpm: values.bpm ? bpmStyle.format(Math.round(values.bpm)) : "",
    key: settings.keyStyle === "long" ? String(values.key || "").trim() : shortKey(values.key),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    format: String(values.format || "").toUpperCase(),
    custom: settings.nameCustom || "",
  };
}

// Builds the saved file's name (no extension) from the user's blocks, in their order.
// Empty blocks are skipped; a producer already named inside the title ("Producer - Beat")
// isn't repeated; characters Windows/macOS don't allow become "_".
function buildName(settings, values) {
  const blockValues = nameBlockValues(values, settings);
  const parts = [];
  for (const id of settings.nameBlocks) {
    const text = String(blockValues[id] || "").trim();
    if (!text) continue;
    if (id === "producer" && parts.join(" ").toLowerCase().includes(text.toLowerCase())) continue;
    parts.push(text);
  }
  const name = parts
    .join(settings.nameSeparator)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 150)
    .trim();
  return name || "instrumental";
}

// "Instrumentals/Client A" -> safe relative path inside the downloads folder ("" if empty).
function cleanSubfolder(value) {
  return String(value || "")
    .split(/[\\/]+/)
    .map((part) => part.replace(/[<>:"|?*\x00-\x1f]/g, "_").trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

// Asks the background worker to analyze a downloaded file on Tunebat (worker context: call
// straight in — `enqueueAnalysis` only exists there).
function requestAnalysis(job) {
  if (typeof enqueueAnalysis === "function") return enqueueAnalysis(job);
  return chrome.runtime.sendMessage({ type: "analysis:enqueue", job });
}

// Starts a Chrome download honoring the Downloads settings. Returns the download id, or
// null if the user cancelled the "save as" dialog. With `meta` ({source, title, producer,
// format, mediaUrl, queueId}) the download is recorded in History and — unless turned
// off in Settings — sent for BPM/key analysis, after which the worker re-saves it under
// its final name.
async function startDownload(url, filename, meta = null, { forceNoDialog = false } = {}) {
  const settings = await getSettings();
  const folder = cleanSubfolder(settings.subfolder);
  const fullName = folder ? `${folder}/${filename}` : filename;
  let downloadId;
  try {
    downloadId = await chrome.downloads.download({ url, filename: fullName, saveAs: forceNoDialog ? false : settings.saveAs });
  } catch (err) {
    if (/cancel/i.test(err.message)) return null;
    throw err;
  }
  if (meta) {
    const historyId = newId();
    // BPM/key already known (a File-tab file analyzed when it was added): nothing to wait for.
    const known = meta.bpm && meta.key;
    const analyze = !known && settings.analyze[meta.source] && meta.analyze !== false;
    await recordHistory({
      ...meta,
      id: historyId,
      filename: fullName,
      fileUrl: url,
      downloadId,
      analysis: known ? "done" : analyze ? "pending" : undefined,
    });
    if (analyze) {
      requestAnalysis({ ...meta, id: historyId, historyId, fileUrl: url, downloadId, filename: fullName }).catch(() => {});
    }
  }
  return downloadId;
}

// A hint for errors that usually mean yt-dlp is out of date.
function withYtdlpHint(message) {
  return /ERROR:|yt-dlp|unable to extract|sign in|HTTP Error 4/i.test(message)
    ? `${message} — if this keeps happening, update yt-dlp in Settings.`
    : message;
}

// --- Link helpers used by the popup and the queue ---


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

// Checks the local server and shows the result in Settings > Local server (dot + text),
// plus a red dot on the Settings gear while it's unreachable so it's visible from any tab.
