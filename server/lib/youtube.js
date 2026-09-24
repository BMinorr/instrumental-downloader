const ytdlp = require("./ytdlp");

// Only accept normal YouTube watch/shorts/youtu.be links, no playlists, no arbitrary query strings
// passed through to the shell (we use spawn with an args array, never string concatenation, to
// avoid command injection).
const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=[\w-]{6,}\S*|shorts\/[\w-]{6,}\S*)|youtu\.be\/[\w-]{6,}\S*)$/i;

function isValidYoutubeUrl(url) {
  return typeof url === "string" && YOUTUBE_URL_RE.test(url.trim());
}

const VIDEO_ID_RE = /(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/i;

function extractVideoId(url) {
  const match = url.match(VIDEO_ID_RE);
  return match ? match[1] : null;
}

async function analyze(url, downloadsDir) {
  if (!isValidYoutubeUrl(url)) {
    throw new Error("Link YouTube invalid.");
  }
  return ytdlp.analyze(url, [], { downloadsDir, id: extractVideoId(url) });
}

// Warms the cache in the background (source + encodes) once a link has been analyzed.
function prepare(url, downloadsDir, convertOptions) {
  return ytdlp.prepare(url, downloadsDir, extractVideoId(url), [], convertOptions);
}

async function downloadAudio(url, format, downloadsDir, convertOptions) {
  if (!isValidYoutubeUrl(url)) {
    throw new Error("Link YouTube invalid.");
  }
  // Deterministic filename (per video + format) so the analysis, the background
  // prefetch and the actual download all reuse the same extracted audio.
  return ytdlp.downloadAudio(url, format, downloadsDir, extractVideoId(url), [], convertOptions);
}

module.exports = { isValidYoutubeUrl, extractVideoId, analyze, prepare, downloadAudio };
