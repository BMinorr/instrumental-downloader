const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const youtube = require("./lib/youtube");
const instagram = require("./lib/instagram");
const { resolveSpotifyToYoutube } = require("./lib/spotify");
const { convertToFormat, isSupportedFormat, outputIdFor } = require("./lib/ytdlp");
const ytdlpUpdate = require("./lib/ytdlp-update");

// Picks the right platform module for a URL (YouTube, or a resolved-from-Spotify
// YouTube URL, or Instagram Story/Reel/Post).
function handlerFor(url) {
  if (youtube.isValidYoutubeUrl(url)) return youtube;
  if (instagram.isValidInstagramUrl(url)) return instagram;
  throw new Error("Link neacceptat. Folosește un link YouTube, Spotify sau Instagram.");
}

const PORT = process.env.PORT || 5177;
const DOWNLOADS_DIR = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const app = express();

// Only the extension may use this server. Browsers attach an Origin header to every
// cross-site request, so any website trying to trigger downloads or a yt-dlp update via
// fetch/form is refused here — CORS alone wouldn't stop a "simple" POST from running.
// (ALLOWED_ORIGINS="http://host:port,…" adds extra origins, for local testing only.)
const EXTRA_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean));
function isAllowedOrigin(origin) {
  return !origin || origin.startsWith("chrome-extension://") || EXTRA_ORIGINS.has(origin);
}
app.use((req, res, next) => {
  if (isAllowedOrigin(req.headers.origin)) return next();
  res.status(403).json({ error: "Origin not allowed." });
});
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) }));
app.use(express.json({ limit: "5mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// yt-dlp version / update (Settings > yt-dlp).
app.get("/api/ytdlp", async (req, res) => {
  try {
    res.json(await ytdlpUpdate.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ytdlp/update", async (req, res) => {
  try {
    res.json(await ytdlpUpdate.update());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { url, loudnorm, targetLufs, prefetch } = req.body || {};
    const handler = handlerFor(url);
    const info = await handler.analyze(url, DOWNLOADS_DIR);
    res.json(info);
    // The user just opened the popup on this link — start fetching + encoding now so
    // the MP3/WAV click has (almost) nothing left to wait for (Settings can turn this off).
    if (prefetch !== false) {
      handler.prepare(url, DOWNLOADS_DIR, { loudnorm, targetLufs }).catch(() => {});
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/download", async (req, res) => {
  try {
    const { url, format, loudnorm, targetLufs } = req.body || {};
    const filePath = await handlerFor(url).downloadAudio(url, format, DOWNLOADS_DIR, {
      loudnorm,
      targetLufs,
    });
    const filename = path.basename(filePath);
    res.json({
      downloadUrl: `/files/${encodeURIComponent(filename)}`,
      filename,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/spotify-resolve", async (req, res) => {
  try {
    const { url, loudnorm, targetLufs, prefetch } = req.body || {};
    const result = await resolveSpotifyToYoutube(url, DOWNLOADS_DIR);
    res.json(result);
    if (prefetch !== false) {
      youtube.prepare(result.youtube.url, DOWNLOADS_DIR, { loudnorm, targetLufs }).catch(() => {});
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Converts an uploaded recording (Sample tab: tab-audio capture) into MP3/WAV,
// the same way YouTube/Spotify/Instagram sources are converted. Takes the raw
// audio bytes directly (not base64-in-JSON) — recordings can be several MB, and
// base64 adds ~33% size plus a JSON re-serialization pass for no benefit here.
app.post(
  "/api/upload-convert",
  express.raw({ type: () => true, limit: "80mb" }),
  async (req, res) => {
    try {
      const format = req.query.format;
      if (!isSupportedFormat(format)) throw new Error("Format neacceptat.");
      if (!req.body || !req.body.length) throw new Error("Lipsesc datele audio.");

      const safeId = `sample-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = String(req.query.sourceExt || "webm").replace(/[^a-z0-9]/gi, "");
      const sourcePath = path.join(DOWNLOADS_DIR, `${safeId}.source.${ext}`);
      fs.writeFileSync(sourcePath, req.body);

      const trimStart = req.query.trimStart !== undefined ? Number(req.query.trimStart) : undefined;
      const trimEnd = req.query.trimEnd !== undefined ? Number(req.query.trimEnd) : undefined;
      const loudnorm = req.query.loudnorm !== "false";
      const targetLufs = req.query.targetLufs;
      const fadeIn = req.query.fadeIn !== undefined ? Number(req.query.fadeIn) : undefined;
      const fadeOut = req.query.fadeOut !== undefined ? Number(req.query.fadeOut) : undefined;
      const duration = req.query.duration !== undefined ? Number(req.query.duration) : undefined;

      const filePath = await convertToFormat(sourcePath, format, DOWNLOADS_DIR, safeId, {
        trimStart,
        trimEnd,
        loudnorm,
        targetLufs,
        fadeIn,
        fadeOut,
        duration,
      });
      const filename = path.basename(filePath);
      res.json({
        downloadUrl: `/files/${encodeURIComponent(filename)}`,
        filename,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// (Both raw-upload routes accept any Content-Type, including none: a File picked from disk
// can have an empty `type` — e.g. an unfamiliar extension — and then fetch() sends no
// Content-Type header at all, which a "*/*" match would treat as "not a body I parse".)
// Stores a file the user picked in the File tab so the extension's background
// worker can fetch it back by URL (same path the downloaded tracks take to reach
// Tunebat) — the popup itself closes as soon as the Tunebat tab opens, so it
// can't hand the bytes over directly. No conversion: the file is served as-is.
const STASH_EXTS = new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a", "aiff", "aif", "opus"]);
const STASH_NAME_RE = /^stash-\d+-[a-z0-9]+\.[a-z0-9]+$/i;
app.post(
  "/api/stash",
  express.raw({ type: () => true, limit: "100mb" }),
  (req, res) => {
    try {
      const ext = String(req.query.ext || "").toLowerCase();
      if (!STASH_EXTS.has(ext)) throw new Error("Tip de fișier neacceptat.");
      if (!req.body || !req.body.length) throw new Error("Fișierul este gol.");

      const filename = `stash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      fs.writeFileSync(path.join(DOWNLOADS_DIR, filename), req.body);
      res.json({ downloadUrl: `/files/${encodeURIComponent(filename)}`, filename });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Converts a file previously stored with /api/stash (File tab) into any supported format.
// The stash is uploaded once and can be converted to several formats without re-uploading.
app.post("/api/convert-stash", async (req, res) => {
  try {
    const { stash, format, loudnorm, targetLufs } = req.body || {};
    if (!isSupportedFormat(format)) throw new Error("Format neacceptat.");
    if (typeof stash !== "string" || !STASH_NAME_RE.test(stash)) throw new Error("Fișier invalid.");

    const sourcePath = path.join(DOWNLOADS_DIR, stash);
    if (!fs.existsSync(sourcePath)) {
      throw new Error("Fișierul a expirat de pe server — alege-l din nou.");
    }

    // "conv-" prefix: the output must never share a name with the stash file itself
    // (e.g. converting a stashed .wav to .wav).
    const options = { loudnorm, targetLufs };
    const outputId = outputIdFor(`conv-${stash.replace(/\.[^.]+$/, "")}`, options);
    const filePath = await convertToFormat(sourcePath, format, DOWNLOADS_DIR, outputId, options);
    const filename = path.basename(filePath);
    res.json({ downloadUrl: `/files/${encodeURIComponent(filename)}`, filename });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve the converted files so the extension can trigger a native browser download.
app.get("/files/:filename", (req, res) => {
  const filename = path.basename(req.params.filename); // strip any path traversal
  const filePath = path.join(DOWNLOADS_DIR, filename);
  if (!filePath.startsWith(DOWNLOADS_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Fișierul nu a fost găsit." });
  }
  res.download(filePath);
});

// Periodic cleanup: remove converted files older than 1 hour so the studio Mac doesn't fill up.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of fs.readdirSync(DOWNLOADS_DIR)) {
    const fp = path.join(DOWNLOADS_DIR, f);
    try {
      if (fs.statSync(fp).mtimeMs < cutoff) fs.rmSync(fp, { force: true });
    } catch {
      // File vanished or is locked (Windows) — skip it, next sweep retries.
    }
  }
}, 15 * 60 * 1000);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Instrumental Downloader server pornit pe http://127.0.0.1:${PORT}`);
  console.log("Lasă acest terminal deschis cât timp folosești extensia.");
});
