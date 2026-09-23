const { runYtDlp } = require("./ytdlp");

const SPOTIFY_URL_RE = /^https?:\/\/open\.spotify\.com\/(intl-[a-z]{2}\/)?track\/([\w]{15,})/i;

function isValidSpotifyUrl(url) {
  return typeof url === "string" && SPOTIFY_URL_RE.test(url.trim());
}

async function fetchSpotifyMetadata(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; InstrumentalDownloader/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Nu am putut încărca pagina Spotify (${res.status}).`);
  }
  const html = await res.text();

  const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/i);
  const descMatch = html.match(/<meta property="og:description" content="([^"]*)"/i);

  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : null;
  // og:description e de forma "Artist · Album · Song · An"
  const artist = descMatch ? decodeHtmlEntities(descMatch[1]).split(" · ")[0] : null;

  if (!title) {
    throw new Error("Nu am putut citi titlul piesei de pe Spotify.");
  }

  return { title, artist };
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function searchYoutube(query) {
  const { stdout } = await runYtDlp([
    "--dump-json",
    "--no-playlist",
    "--default-search",
    "ytsearch1",
    query,
  ]);
  try {
    const info = JSON.parse(stdout.trim().split("\n").pop());
    return {
      id: info.id,
      url: `https://www.youtube.com/watch?v=${info.id}`,
      title: info.title,
      uploader: info.uploader,
      duration: info.duration,
      thumbnail: info.thumbnail,
    };
  } catch {
    throw new Error("Niciun rezultat găsit pe YouTube pentru această piesă.");
  }
}

async function resolveSpotifyToYoutube(url) {
  if (!isValidSpotifyUrl(url)) {
    throw new Error("Link Spotify invalid. Trebuie să fie un link către o piesă (track).");
  }

  const spotify = await fetchSpotifyMetadata(url);
  const query = [spotify.artist, spotify.title, "audio"].filter(Boolean).join(" ");
  const youtube = await searchYoutube(query);

  return { spotify, youtube };
}

module.exports = { isValidSpotifyUrl, resolveSpotifyToYoutube };
