const ytdlp = require("./ytdlp");

// Only accept normal YouTube watch/shorts/youtu.be links, no playlists, no arbitrary query strings
// passed through to the shell (we use spawn with an args array, never string concatenation, to
// avoid command injection).
const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=[\w-]{6,}\S*|shorts\/[\w-]{6,}\S*)|youtu\.be\/[\w-]{6,}\S*)$/i;

// A YouTube playlist: /playlist?list=… or any watch link that carries a list=… parameter.
const PLAYLIST_URL_RE =
  /^https?:\/\/(www\.|m\.)?youtube\.com\/(playlist\?(\S*&)?list=[\w-]+|watch\?(\S*&)?v=[\w-]{6,}\S*[&?]list=[\w-]+)/i;
const PLAYLIST_MAX = 100;

function isValidPlaylistUrl(url) {
  return typeof url === "string" && PLAYLIST_URL_RE.test(url.trim());
}

// The videos in a playlist, without extracting each one (fast: one flat listing).
async function listPlaylist(url) {
  if (!isValidPlaylistUrl(url)) throw new Error("Link de playlist YouTube invalid.");
  const listId = url.match(/[?&]list=([\w-]+)/i)[1];
  const { stdout } = await ytdlp.runYtDlp([
    "--flat-playlist",
    "--dump-single-json",
    "--playlist-end", String(PLAYLIST_MAX),
    // Always the plain playlist page, so a watch?v=…&list=… link lists the whole list.
    `https://www.youtube.com/playlist?list=${listId}`,
  ]);
  const data = JSON.parse(stdout);
  const items = (data.entries || [])
    .filter((e) => e && e.id)
    .map((e) => ({
      id: e.id,
      title: e.title || e.id,
      duration: e.duration || null,
      uploader: e.uploader || e.channel || "",
      url: `https://www.youtube.com/watch?v=${e.id}`,
    }));
  return { title: data.title || "Playlist", items, truncated: (data.playlist_count || items.length) > items.length };
}

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

function savedMeta(url, downloadsDir) {
  return ytdlp.savedMeta(downloadsDir, extractVideoId(url));
}

module.exports = {
  isValidYoutubeUrl,
  isValidPlaylistUrl,
  listPlaylist,
  extractVideoId,
  analyze,
  prepare,
  downloadAudio,
  savedMeta,
};
