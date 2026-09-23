const ytdlp = require("./ytdlp");

// Story, Reel sau Post — toate pot conține instrumentale trimise de clienți.
// Instagram folosește "/reel/<id>/" pe linkurile partajate și "/reels/<id>/" în feed — acceptăm ambele.
// Un link de Story poate fi "/stories/username/" (story-ul activ curent, fără ID) sau
// "/stories/username/12345/" (un anume story, cu ID numeric) — acceptăm ambele.
const INSTAGRAM_URL_RE =
  /^https?:\/\/(www\.)?instagram\.com\/(stories\/([\w.]+)(?:\/(\d+))?|(p|reels?)\/([\w-]+))\/?/i;

function isValidInstagramUrl(url) {
  return typeof url === "string" && INSTAGRAM_URL_RE.test(url.trim());
}

function extractInstagramId(url) {
  const match = url.match(INSTAGRAM_URL_RE);
  if (!match) return null;
  // ID numeric de story (dacă există) sau shortcode-ul de post/reel. Un story fără ID
  // numeric (link generic către "story-ul activ") nu primește id stabil — conținutul
  // acolo se schimbă, deci nu vrem să refolosim un fișier vechi din cache.
  return match[4] || match[6] || null;
}

// Story-urile Instagram (și uneori postările de la conturi private) nu sunt
// accesibile fără autentificare. Folosim cookie-urile din browser-ul deja logat
// pe acest calculator, exact cum ar accesa utilizatorul conținutul manual —
// yt-dlp doar citește sesiunea existentă, nu ocolește nicio protecție.
const COOKIES_BROWSER = process.env.COOKIES_BROWSER || "chrome";
const AUTH_ARGS = ["--cookies-from-browser", COOKIES_BROWSER];

function wrapAuthError(err) {
  const msg = err.message || "";
  if (/login|rate-limit|restricted video|private/i.test(msg)) {
    return new Error(
      `Instagram cere autentificare pentru acest conținut. Asigură-te că ești logat pe Instagram în ${COOKIES_BROWSER} pe acest calculator, apoi încearcă din nou.`
    );
  }
  return err;
}

async function analyze(url) {
  if (!isValidInstagramUrl(url)) {
    throw new Error("Link Instagram invalid. Trebuie să fie un Story, Reel sau Post.");
  }
  try {
    return await ytdlp.analyze(url, AUTH_ARGS);
  } catch (err) {
    throw wrapAuthError(err);
  }
}

async function downloadAudio(url, format, downloadsDir, convertOptions) {
  if (!isValidInstagramUrl(url)) {
    throw new Error("Link Instagram invalid. Trebuie să fie un Story, Reel sau Post.");
  }
  try {
    return await ytdlp.downloadAudio(url, format, downloadsDir, extractInstagramId(url), AUTH_ARGS, convertOptions);
  } catch (err) {
    throw wrapAuthError(err);
  }
}

module.exports = { isValidInstagramUrl, extractInstagramId, analyze, downloadAudio };
