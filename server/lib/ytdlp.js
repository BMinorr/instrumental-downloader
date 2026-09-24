const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "yt-dlp nu a fost găsit. Instalează-l cu: brew install yt-dlp"
          )
        );
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || `yt-dlp a eșuat cu codul ${code}`));
      }
    });
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c));
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("ffmpeg nu a fost găsit. Instalează-l cu: brew install ffmpeg"));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(stderr.trim() || `ffmpeg a eșuat cu codul ${code}`));
    });
  });
}

// Two requests for the same track/target (e.g. the popup was closed and reopened
// mid-download) share one job instead of racing on the same output files.
const inflight = new Map();
function dedupe(key, job) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = job().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

// Only finished media files count as a cached source — yt-dlp leaves `.part` /
// `.ytdl` / fragment files behind while downloading or after a failure, and
// treating those as a cache hit would feed a truncated file to ffmpeg.
const SOURCE_EXT_RE = /\.(webm|m4a|mp4|opus|ogg|mp3|aac|wav|flac|mkv|3gp)$/i;
function findCachedSource(downloadsDir, safeId) {
  const found = fs
    .readdirSync(downloadsDir)
    .find((f) => f.startsWith(`${safeId}.source.`) && SOURCE_EXT_RE.test(f));
  return found ? path.join(downloadsDir, found) : null;
}

function runFfprobe(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    proc.stdout.on("data", (c) => (stdout += c));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error("ffprobe failed"))));
  });
}

// --- Output formats ---------------------------------------------------------------------
// Kept in sync with FORMATS in extension/popup.js. `hiRes` = the encoder gets a 24-bit
// variant when the source itself is 24-bit (so converting a 24-bit WAV to WAV/AIFF/FLAC
// doesn't silently drop to 16-bit); lossy sources always produce 16-bit.
const FORMATS = {
  mp3: { args: () => ["-codec:a", "libmp3lame", "-b:a", "320k"] },
  wav: { hiRes: true, args: (hi) => ["-codec:a", hi ? "pcm_s24le" : "pcm_s16le"] },
  flac: {
    hiRes: true,
    args: (hi) => ["-codec:a", "flac", ...(hi ? ["-sample_fmt", "s32", "-bits_per_raw_sample", "24"] : ["-sample_fmt", "s16"])],
  },
  aiff: { hiRes: true, args: (hi) => ["-codec:a", hi ? "pcm_s24be" : "pcm_s16be"] },
  m4a: { args: () => ["-codec:a", "aac", "-b:a", "320k"] },
  opus: { args: () => ["-codec:a", "libopus", "-b:a", "192k"] },
};

function isSupportedFormat(format) {
  return Object.prototype.hasOwnProperty.call(FORMATS, format);
}

// True when the source's samples are 24-bit or wider PCM/FLAC. Lossy codecs (mp3, aac,
// opus, vorbis) decode to float but report no bit depth, so they correctly come out false.
// If ffprobe is missing or fails we just fall back to 16-bit.
async function isHiResSource(sourcePath) {
  try {
    const out = await runFfprobe([
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,bits_per_raw_sample,bits_per_sample",
      "-of", "json", sourcePath,
    ]);
    const stream = JSON.parse(out).streams?.[0];
    if (!stream) return false;
    const raw = Number(stream.bits_per_raw_sample) || 0;
    const pcmBits = String(stream.codec_name).startsWith("pcm_") ? Number(stream.bits_per_sample) || 0 : 0;
    return Math.max(raw, pcmBits) >= 24;
  } catch {
    return false;
  }
}

// --- Metadata (yt-dlp extraction) --------------------------------------------------
// Extraction is the slow part of any yt-dlp call (~3-5s: page + player + JS challenge),
// while the actual audio download is under a second. So the full info JSON is saved
// once per media id and reused: "analyze" writes it, the download loads it instead of
// extracting again (`--load-info-json`), which removes the second extraction entirely.

function infoPath(downloadsDir, id) {
  return path.join(downloadsDir, `${id}.info.json`);
}

function saveInfo(downloadsDir, id, info) {
  if (!id) return;
  const tmp = `${infoPath(downloadsDir, id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info));
  fs.renameSync(tmp, infoPath(downloadsDir, id));
}

function readSavedInfo(downloadsDir, id) {
  if (!id) return null;
  try {
    return JSON.parse(fs.readFileSync(infoPath(downloadsDir, id), "utf8"));
  } catch {
    return null;
  }
}

async function getInfo(url, downloadsDir, id, extraArgs = []) {
  return dedupe(`info:${id || url}`, async () => {
    const saved = readSavedInfo(downloadsDir, id);
    if (saved) return saved;

    const { stdout } = await runYtDlp([
      "--dump-json",
      "--no-playlist",
      "--skip-download",
      ...extraArgs,
      url,
    ]);
    const info = JSON.parse(stdout.trim().split("\n").pop());
    saveInfo(downloadsDir, id, info);
    return info;
  });
}

async function analyze(url, extraArgs = [], { downloadsDir, id } = {}) {
  const info = await getInfo(url, downloadsDir, id, extraArgs);
  return {
    title: info.title,
    duration: info.duration, // seconds
    thumbnail: info.thumbnail,
    uploader: info.uploader,
  };
}

// Downloads the raw audio (no re-encode) once per track and caches it separately
// from the final format — asking for the other format later converts locally from
// the source already on disk, with no network.
async function downloadRawSource(url, downloadsDir, id, safeId, extraArgs) {
  return dedupe(`source:${safeId}`, async () => {
    const existing = findCachedSource(downloadsDir, safeId);
    if (existing) return existing;

    // With a saved info JSON the download skips extraction. If the saved URLs have
    // gone stale (expired/blocked), drop it and fall back to a full extraction.
    let fromInfo = false;
    if (id) {
      await getInfo(url, downloadsDir, id, extraArgs);
      fromInfo = fs.existsSync(infoPath(downloadsDir, id));
    }

    const outputTemplate = path.join(downloadsDir, `${safeId}.source.%(ext)s`);
    const run = (useInfo) =>
      runYtDlp([
        "--no-playlist",
        "-f", "bestaudio/best",
        "--concurrent-fragments", "4", // download DASH fragments in parallel
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        ...extraArgs,
        ...(useInfo ? ["--load-info-json", infoPath(downloadsDir, id)] : [url]),
      ]);

    let stdout;
    try {
      stdout = (await run(fromInfo)).stdout;
    } catch (err) {
      if (!fromInfo) throw err;
      fs.rmSync(infoPath(downloadsDir, id), { force: true });
      stdout = (await run(false)).stdout;
    }

    const lines = stdout.trim().split("\n").filter(Boolean);
    let filePath = lines[lines.length - 1];

    if (!filePath || !fs.existsSync(filePath)) {
      filePath = findCachedSource(downloadsDir, safeId);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error("Descărcarea a eșuat: fișierul sursă nu a fost găsit.");
    }

    return filePath;
  });
}

// --- Loudness normalization ---------------------------------------------------------
// ffmpeg's `loudnorm` filter is accurate but slow (it oversamples for true-peak
// detection): ~6-7s on a 3.5 minute track, longer than the MP3 encode itself. Instead
// we measure integrated loudness once with the fast `ebur128` filter (~0.4s), then
// apply that as a static gain plus a limiter at -1.5 dBFS. Same -16 LUFS target, but a
// static gain also leaves the track's dynamics untouched (loudnorm's one-pass mode
// rides the volume up and down), which matters for instrumentals going to mixing.

const TARGET_LUFS = -16;
const LIMITER_CEILING = 0.841; // -1.5 dBFS, linear

const loudnessCache = new Map(); // "source|start|end" -> integrated LUFS (or null if unmeasurable)

function trimArgs(options) {
  const args = [];
  if (typeof options.trimStart === "number" && options.trimStart > 0) {
    args.push("-ss", options.trimStart.toFixed(2));
  }
  if (typeof options.trimEnd === "number") {
    args.push("-to", options.trimEnd.toFixed(2));
  }
  return args;
}

async function measureLoudness(sourcePath, options = {}) {
  const key = `${sourcePath}|${options.trimStart || 0}|${options.trimEnd ?? ""}`;
  if (loudnessCache.has(key)) return loudnessCache.get(key);

  return dedupe(`measure:${key}`, async () => {
    const { stderr } = await runFfmpeg([
      "-hide_banner", "-nostats",
      "-i", sourcePath,
      ...trimArgs(options),
      "-vn",
      "-af", "ebur128=framelog=quiet",
      "-f", "null", "-",
    ]);
    // Summary block: "Integrated loudness:\n    I:         -13.0 LUFS"
    const match = [...stderr.matchAll(/\bI:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)].pop();
    const lufs = match ? Number(match[1]) : null;
    loudnessCache.set(key, lufs);
    return lufs;
  });
}

async function loudnessFilter(sourcePath, options) {
  const lufs = await measureLoudness(sourcePath, options);
  // Silence / unmeasurable audio: leave it alone rather than applying a huge gain.
  if (lufs === null || lufs < -60) return null;
  const gainDb = Math.max(-30, Math.min(24, TARGET_LUFS - lufs));
  return `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${LIMITER_CEILING}:level=0`;
}

// `options.trimStart`/`options.trimEnd` (seconds) cut the clip before encoding —
// used by the Sample tab's waveform trim handles. Loudness is normalized unless
// `options.loudnorm === false` (Settings toggle).
async function convertToFormat(sourcePath, format, downloadsDir, safeId, options = {}) {
  if (!isSupportedFormat(format)) throw new Error("Format neacceptat.");
  const targetPath = path.join(downloadsDir, `${safeId}.${format}`);
  if (fs.existsSync(targetPath)) return targetPath;

  return dedupe(`convert:${targetPath}`, async () => {
    if (fs.existsSync(targetPath)) return targetPath;

    const args = ["-y", "-i", sourcePath, ...trimArgs(options), "-vn"];

    if (options.loudnorm !== false) {
      const filter = await loudnessFilter(sourcePath, options);
      if (filter) args.push("-af", filter);
    }

    const spec = FORMATS[format];
    const hiRes = spec.hiRes ? await isHiResSource(sourcePath) : false;
    args.push(...spec.args(hiRes));

    // Encode to a temp name and rename on success: ffmpeg creates its output file
    // immediately, so a failed/interrupted run would otherwise leave a truncated
    // file at the final path that later requests would serve as a "cache hit".
    const partialPath = path.join(downloadsDir, `${safeId}.partial.${format}`);
    args.push(partialPath);

    try {
      await runFfmpeg(args);
      if (!fs.existsSync(partialPath)) {
        throw new Error("Conversia a eșuat: fișierul de ieșire nu a fost găsit.");
      }
      fs.renameSync(partialPath, targetPath);
    } catch (err) {
      fs.rmSync(partialPath, { force: true });
      throw err;
    }
    return targetPath;
  });
}

function outputIdFor(safeId, convertOptions) {
  // `loudnorm: false` gets a distinct output id (`-raw`) so the cache never mixes up
  // the normalized (default) and untouched versions of the same track.
  return convertOptions.loudnorm === false ? `${safeId}-raw` : safeId;
}

// Downloads + extracts audio in the requested format, caching both the raw source
// and each final format (per `id`) — a request for the other format on the same
// track reuses the source already downloaded.
async function downloadAudio(url, format, downloadsDir, id, extraArgs = [], convertOptions = {}) {
  if (!isSupportedFormat(format)) {
    throw new Error("Format neacceptat.");
  }

  const safeId = id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputId = outputIdFor(safeId, convertOptions);
  const targetPath = path.join(downloadsDir, `${outputId}.${format}`);

  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const sourcePath = await downloadRawSource(url, downloadsDir, id, safeId, extraArgs);
  return convertToFormat(sourcePath, format, downloadsDir, outputId, convertOptions);
}

// Runs right after a track is analyzed (fire-and-forget): the popup was just opened on
// this link, so the user is very likely about to pick MP3 or WAV. Getting the source and
// both encodes done while they look at the screen makes the click near-instant. A click
// that arrives mid-way shares these same in-flight jobs (see `dedupe`), never duplicates.
// Tracks without a stable id (e.g. "current story" links) are skipped — nothing to reuse.
async function prepare(url, downloadsDir, id, extraArgs = [], convertOptions = {}) {
  if (!id) return;
  const sourcePath = await downloadRawSource(url, downloadsDir, id, id, extraArgs);
  const outputId = outputIdFor(id, convertOptions);
  await Promise.all(
    ["mp3", "wav"].map((format) =>
      convertToFormat(sourcePath, format, downloadsDir, outputId, convertOptions)
    )
  );
}

module.exports = {
  runYtDlp,
  runFfmpeg,
  analyze,
  saveInfo,
  prepare,
  isSupportedFormat,
  downloadAudio,
  convertToFormat,
};
