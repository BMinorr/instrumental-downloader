const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const youtube = require("./lib/youtube");
const instagram = require("./lib/instagram");
const { resolveSpotifyToYoutube } = require("./lib/spotify");
const { convertToFormat } = require("./lib/ytdlp");

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
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { url } = req.body || {};
    const info = await handlerFor(url).analyze(url);
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/download", async (req, res) => {
  try {
    const { url, format, loudnorm } = req.body || {};
    const filePath = await handlerFor(url).downloadAudio(url, format, DOWNLOADS_DIR, { loudnorm });
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
    const { url } = req.body || {};
    const result = await resolveSpotifyToYoutube(url);
    res.json(result);
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
  express.raw({ type: "*/*", limit: "80mb" }),
  async (req, res) => {
    try {
      const format = req.query.format;
      if (format !== "mp3" && format !== "wav") throw new Error("Format neacceptat.");
      if (!req.body || !req.body.length) throw new Error("Lipsesc datele audio.");

      const safeId = `sample-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = String(req.query.sourceExt || "webm").replace(/[^a-z0-9]/gi, "");
      const sourcePath = path.join(DOWNLOADS_DIR, `${safeId}.source.${ext}`);
      fs.writeFileSync(sourcePath, req.body);

      const trimStart = req.query.trimStart !== undefined ? Number(req.query.trimStart) : undefined;
      const trimEnd = req.query.trimEnd !== undefined ? Number(req.query.trimEnd) : undefined;
      const loudnorm = req.query.loudnorm !== "false";

      const filePath = await convertToFormat(sourcePath, format, DOWNLOADS_DIR, safeId, {
        trimStart,
        trimEnd,
        loudnorm,
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

// Stores a file the user picked in the File tab so the extension's background
// worker can fetch it back by URL (same path the downloaded tracks take to reach
// Tunebat) — the popup itself closes as soon as the Tunebat tab opens, so it
// can't hand the bytes over directly. No conversion: the file is served as-is.
const STASH_EXTS = new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a"]);
app.post(
  "/api/stash",
  express.raw({ type: "*/*", limit: "100mb" }),
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
