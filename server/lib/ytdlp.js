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
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg a eșuat cu codul ${code}`));
    });
  });
}

async function analyze(url, extraArgs = []) {
  const { stdout } = await runYtDlp([
    "--dump-json",
    "--no-playlist",
    "--skip-download",
    ...extraArgs,
    url,
  ]);
  const info = JSON.parse(stdout.trim().split("\n").pop());
  return {
    title: info.title,
    duration: info.duration, // seconds
    thumbnail: info.thumbnail,
    uploader: info.uploader,
  };
}

// Descarcă audio-ul brut (fără reconversie) o singură dată per piesă și îl cache-uiește
// separat de formatul final — dacă ceri mai târziu și celălalt format (mp3 după wav, sau
// invers), conversia se face local din sursa deja descărcată, fără să mai bată net-ul.
async function downloadRawSource(url, downloadsDir, safeId, extraArgs) {
  const existing = fs.readdirSync(downloadsDir).find((f) => f.startsWith(`${safeId}.source.`));
  if (existing) return path.join(downloadsDir, existing);

  const outputTemplate = path.join(downloadsDir, `${safeId}.source.%(ext)s`);
  const args = [
    "--no-playlist",
    "-f", "bestaudio/best",
    "--concurrent-fragments", "4", // descarcă fragmentele DASH în paralel — mai rapid pe conexiuni bune
    "-o", outputTemplate,
    "--print", "after_move:filepath",
    "--no-simulate",
    ...extraArgs,
    url,
  ];

  const { stdout } = await runYtDlp(args);
  const lines = stdout.trim().split("\n").filter(Boolean);
  let filePath = lines[lines.length - 1];

  if (!filePath || !fs.existsSync(filePath)) {
    const match = fs.readdirSync(downloadsDir).find((f) => f.startsWith(`${safeId}.source.`));
    if (match) filePath = path.join(downloadsDir, match);
  }

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("Descărcarea a eșuat: fișierul sursă nu a fost găsit.");
  }

  return filePath;
}

// `options.trimStart`/`options.trimEnd` (seconds) cut the clip before encoding —
// used by the Sample tab's waveform trim handles. Loudness is normalized on every
// conversion (EBU R128, -16 LUFS target) so instrumentals from different sources/
// clients land at a consistent perceived volume instead of wildly different levels.
async function convertToFormat(sourcePath, format, downloadsDir, safeId, options = {}) {
  const targetPath = path.join(downloadsDir, `${safeId}.${format}`);
  if (fs.existsSync(targetPath)) return targetPath;

  const args = ["-y", "-i", sourcePath];

  if (typeof options.trimStart === "number" && options.trimStart > 0) {
    args.push("-ss", options.trimStart.toFixed(2));
  }
  if (typeof options.trimEnd === "number") {
    args.push("-to", options.trimEnd.toFixed(2));
  }

  args.push("-vn");
  if (options.loudnorm !== false) {
    args.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
  }

  if (format === "mp3") {
    args.push("-codec:a", "libmp3lame", "-b:a", "320k");
  } else {
    args.push("-codec:a", "pcm_s16le");
  }
  args.push(targetPath);

  await runFfmpeg(args);

  if (!fs.existsSync(targetPath)) {
    throw new Error("Conversia a eșuat: fișierul de ieșire nu a fost găsit.");
  }
  return targetPath;
}

// Descarcă + extrage audio în formatul cerut, cache-uind atât sursa brută cât și
// fiecare format final (per `id`) — o cerere pentru celălalt format pe aceeași
// piesă reutilizează sursa deja descărcată, fără re-descărcare.
// `convertOptions.loudnorm: false` dă un id de output distinct (`-raw`), ca să nu
// se confunde cache-ul cu varianta normalizată (implicită) a aceleiași piese.
async function downloadAudio(url, format, downloadsDir, id, extraArgs = [], convertOptions = {}) {
  if (format !== "mp3" && format !== "wav") {
    throw new Error("Format neacceptat. Folosește mp3 sau wav.");
  }

  const safeId = id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputId = convertOptions.loudnorm === false ? `${safeId}-raw` : safeId;
  const targetPath = path.join(downloadsDir, `${outputId}.${format}`);

  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const sourcePath = await downloadRawSource(url, downloadsDir, safeId, extraArgs);
  return convertToFormat(sourcePath, format, downloadsDir, outputId, convertOptions);
}

module.exports = { runYtDlp, runFfmpeg, analyze, downloadAudio, convertToFormat };
