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


const QUEUE_KEY = "queue"; // download queue (see queue-engine.js / queue.js)
const HISTORY_KEY = "history";
const HISTORY_MAX = 30;

async function loadHistory() {
  const items = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(items[HISTORY_KEY]) ? items[HISTORY_KEY] : [];
}

// Called by startDownload() for every download that was actually started.
async function recordHistory(entry) {
  const list = await loadHistory();
  list.unshift({ ...entry, ts: Date.now() });
  await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, HISTORY_MAX) });
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
  fileNameTemplate: "settings.fileNameTemplate",
  analysisNameTemplate: "settings.analysisNameTemplate",
  deleteOriginal: "settings.deleteOriginal",
};
const LEGACY_NORMALIZE_KEY = "settings.loudnorm"; // single toggle from before there was one per category

// All settings with their defaults applied. Link/Sample normalize by default (as they
// always did); File conversions don't — converting a file shouldn't change its level
// unless asked to.
async function getSettings() {
  const items = await chrome.storage.local.get([...Object.values(SETTING_KEYS), LEGACY_NORMALIZE_KEY]);
  const legacy = items[LEGACY_NORMALIZE_KEY];
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
    fileNameTemplate: items[SETTING_KEYS.fileNameTemplate] || "{title}",
    analysisNameTemplate: items[SETTING_KEYS.analysisNameTemplate] || DEFAULT_ANALYSIS_TEMPLATE,
    deleteOriginal: items[SETTING_KEYS.deleteOriginal] ?? false,
  };
}

// Saved list of visible formats, cleaned up: unknown ids dropped, never empty.
function validFormatIds(saved) {
  const all = FORMATS.map((f) => f.id);
  const ids = Array.isArray(saved) ? all.filter((id) => saved.includes(id)) : all;
  return ids.length ? ids : all;
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

// Builds the saved file's name (without extension) from the "File name" setting.
// `{title}` and `{uploader}`; separators left dangling by an empty value ("{uploader} - {title}"
// with no uploader) are trimmed, and characters Windows/macOS don't allow become "_".
function buildFileName(template, values) {
  const name = String(template || "{title}")
    .replace(/\{(title|uploader)\}/g, (_, key) => values[key] || "")
    .replace(/\(\s*\)|\[\s*\]/g, "") // brackets left empty by a missing value
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–_.]+|[\s\-–_.]+$/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
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

// Starts a Chrome download honoring the Downloads settings. Returns the download id, or
// null if the user cancelled the "save as" dialog.
async function startDownload(url, filename, meta = null, { forceNoDialog = false } = {}) {
  const { saveAs, subfolder } = await getSettings();
  const folder = cleanSubfolder(subfolder);
  const fullName = folder ? `${folder}/${filename}` : filename;
  let downloadId;
  try {
    downloadId = await chrome.downloads.download({ url, filename: fullName, saveAs: forceNoDialog ? false : saveAs });
  } catch (err) {
    if (/cancel/i.test(err.message)) return null;
    throw err;
  }
  if (meta) {
    recordHistory({ ...meta, filename: fullName, fileUrl: url, downloadId }).catch(() => {});
  }
  return downloadId;
}


// A hint for errors that usually mean yt-dlp is out of date.
function withYtdlpHint(message) {
  return /ERROR:|yt-dlp|unable to extract|sign in|HTTP Error 4/i.test(message)
    ? `${message} — if this keeps happening, update yt-dlp in Settings.`
    : message;
}



// --- Tunebat analysis results (BPM / key) ---
// background.js reads them off the Tunebat page after a file is analyzed and stores them
// per server file URL; the popup shows them and can save a copy named with BPM + key.

const ANALYSIS_PREFIX = "analysis:";

const DEFAULT_ANALYSIS_TEMPLATE = "{title} - {bpm}bpm - {keyshort}";

async function getAnalysis(fileUrl) {
  if (!fileUrl) return null;
  const items = await chrome.storage.local.get(ANALYSIS_PREFIX + fileUrl);
  return items[ANALYSIS_PREFIX + fileUrl] || null;
}

// "A minor" -> "Am", "F# major" -> "F#", "B♭ minor" -> "Bbm" (short form for file names).
function shortKey(key) {
  const match = String(key || "").trim().match(/^([A-G])\s*([#♯b♭]?)\s*(major|minor)$/i);
  if (!match) return "";
  const accidental = match[2].replace("♯", "#").replace("♭", "b");
  return `${match[1].toUpperCase()}${accidental}${match[3].toLowerCase() === "minor" ? "m" : ""}`;
}

// Name for the "with BPM & key" copy. Placeholders: {title} (the saved file's name),
// {bpm}, {key} ("A minor"), {keyshort} ("Am"), {camelot} ("8A").
function buildAnalysisName(template, values) {
  const name = String(template || DEFAULT_ANALYSIS_TEMPLATE)
    .replace(/\{(title|bpm|key|keyshort|camelot)\}/g, (_, k) => values[k] ?? "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–_.]+|[\s\-–_.]+$/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 150)
    .trim();
  return name || "instrumental";
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
