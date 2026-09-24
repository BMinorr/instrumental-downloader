// Link tab: load a link (current tab or pasted), preview it and download it.

let currentCacheKey = null;
// What the MP3/WAV buttons act on. Set by renderTrack (possibly twice for YouTube: first
// an instant preview built from the tab itself, then the server's authoritative data).
let currentMedia = null; // { url, title }

let activeTabInfo = { url: "", title: "" };
// Bumped on every loadLink(): a slow response for a link the user has since replaced
// (by pasting another) must not overwrite the newer one.
let linkLoadId = 0;

// Loads a link into the Link tab: the current tab's page on open, or a pasted link.
async function loadLink(url, { tabTitle = "", pasted = false } = {}) {
  const loadId = ++linkLoadId;
  const stale = () => loadId !== linkLoadId;
  resetLinkView();

  const platform = detectPlatform(url);
  if (platform === "unknown") {
    els.statusMessage.textContent = pasted
      ? "That doesn't look like a YouTube, Spotify or Instagram link."
      : "Open a YouTube video, a Spotify track or an Instagram Story/Reel/Post — or paste a link above.";
    els.statusMessage.classList.remove("hidden");
    checkServer();
    return;
  }

  currentCacheKey = extractMediaId(url);

  // Per-page cache: if this link was already processed, show everything instantly
  // with no network calls at all — zero wait on reopen.
  if (currentCacheKey) {
    const cached = await getCachedBundle(currentCacheKey);
    if (stale()) return;
    if (cached) {
      checkServer();
      renderTrack(cached.mediaUrl, cached);
      updateTunebatButton(els.btnTunebat, cached.downloadedFile);
      return;
    }
  }

  showSkeleton();
  if (platform === "youtube") {
    if (tabTitle) showInstantPreview(url, tabTitle);
    else if (pasted) showOembedPreview(url, stale); // no tab to read the title from
  }

  const serverOk = await checkServer();
  if (stale()) return;
  if (!serverOk) {
    els.statusMessage.textContent = "Start the local server (server/npm start) to download.";
    els.statusMessage.classList.remove("hidden");
    els.trackInfo.classList.add("hidden");
    els.formatOptions.classList.add("hidden");
    return;
  }

  if (platform === "spotify") {
    await handleSpotify(url, stale);
  } else {
    // YouTube and Instagram share the same direct flow (the server decides the platform from the link).
    await handleDirect(url, stale);
  }
}

// Clears everything a previously loaded link left in the Link tab.
function resetLinkView() {
  currentMedia = null;
  currentCacheKey = null;
  els.statusMessage.classList.add("hidden");
  els.trackInfo.classList.add("hidden");
  els.formatOptions.classList.add("hidden");
  els.progress.classList.add("hidden");
  els.progress.textContent = "";
  els.btnTunebat.classList.add("hidden");
  delete els.btnTunebat.dataset.fileUrl;
  delete els.btnTunebat.dataset.filename;
  delete els.btnTunebat.dataset.downloadId;
  analysisCardFor.get(els.btnTunebat)?.refresh();
  els.thumbnail.removeAttribute("src");
}

// --- Paste-a-link row (Link tab) ---
// Lets you load a link without opening its page first: copy the link a client sent, open
// the extension, paste. Pasting loads it straight away; Enter/→ loads whatever is typed;
// an empty field + Enter goes back to the page in the current tab.

function extractUrl(text) {
  const match = String(text).match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : "";
}

function initPasteRow() {
  const submit = () => {
    const raw = els.pasteInput.value.trim();
    if (!raw) {
      loadLink(activeTabInfo.url, { tabTitle: activeTabInfo.title });
      return;
    }
    const url = extractUrl(raw);
    els.pasteInput.value = url || raw;
    loadLink(url, { pasted: true });
  };
  els.pasteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  els.pasteInput.addEventListener("paste", () => setTimeout(submit, 0)); // after the text lands
  els.pasteGo.addEventListener("click", submit);

  // Nothing to load from the current tab -> the pasted link is the only thing to do here.
  if (detectPlatform(activeTabInfo.url) === "unknown") els.pasteInput.focus();
}

// Instant title + thumbnail for a pasted YouTube link (YouTube's public oEmbed, ~0.3 s),
// while the server's analysis (~3 s) fills in the rest. Best effort: failures are ignored.
async function showOembedPreview(url, stale) {
  const id = extractMediaId(url);
  if (!id) return;
  setThumbnail(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    const info = await res.json();
    if (stale() || els.trackTitle.textContent !== "Loading…") return; // analysis already answered
    renderTrack(url, { title: info.title, uploader: info.author_name });
  } catch {
    // stay on the skeleton until the analysis arrives
  }
}

function showSkeleton() {
  els.trackInfo.classList.remove("hidden");
  setThumbnail(null);
  els.trackTitle.textContent = "Loading…";
  els.trackTitle.classList.add("placeholder");
  els.trackMeta.textContent = "";

  els.formatOptions.classList.remove("hidden");
  linkGrid.setLoading(true);
}

async function handleDirect(url, stale = () => false) {
  try {
    const res = await fetch(`${SERVER}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ...(await getAnalyzeOptions()) }),
    });
    const data = await res.json();
    if (stale()) return;
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    renderTrack(url, data);
    if (currentCacheKey) setCachedBundle(currentCacheKey, { ...data, mediaUrl: url });
  } catch (err) {
    if (stale()) return;
    els.statusMessage.textContent = `Error: ${withYtdlpHint(err.message)}`;
    els.statusMessage.classList.remove("hidden");
    els.trackInfo.classList.add("hidden");
    els.formatOptions.classList.add("hidden");
  }
}

async function handleSpotify(spotifyUrl, stale = () => false) {
  try {
    const res = await fetch(`${SERVER}/api/spotify-resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: spotifyUrl, ...(await getAnalyzeOptions()) }),
    });
    const data = await res.json();
    if (stale()) return;
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    els.statusMessage.textContent = `Found on YouTube: "${data.youtube.title}"`;
    els.statusMessage.classList.remove("hidden");
    renderTrack(data.youtube.url, data.youtube);
    if (currentCacheKey) setCachedBundle(currentCacheKey, { ...data.youtube, mediaUrl: data.youtube.url });
  } catch (err) {
    if (stale()) return;
    els.statusMessage.textContent = `Error: ${withYtdlpHint(err.message)}`;
    els.statusMessage.classList.remove("hidden");
    els.trackInfo.classList.add("hidden");
    els.formatOptions.classList.add("hidden");
  }
}

function renderTrack(mediaUrl, data) {
  currentMedia = { url: mediaUrl, title: data.title };

  els.trackInfo.classList.remove("hidden");
  // Keep an already-loaded preview thumbnail instead of swapping in the (identical) one
  // from the server, which would flash the placeholder again.
  if (!els.thumbnail.getAttribute("src")) {
    setThumbnail(data.thumbnail);
    if (!data.thumbnail) els.thumbnail.parentElement.classList.remove("loading"); // nothing coming
  }
  els.trackTitle.textContent = data.title || "Untitled";
  els.trackTitle.classList.remove("placeholder");
  els.trackMeta.textContent = [data.uploader, formatDuration(data.duration)]
    .filter(Boolean)
    .join(" · ");

  els.formatOptions.classList.remove("hidden");
  linkGrid.setLoading(false);
}

// Gray placeholder box (#thumb-box) until the thumbnail has actually loaded.
function setThumbnail(url) {
  const img = els.thumbnail;
  const box = img.parentElement;
  img.classList.remove("loaded");
  box.classList.add("loading");
  img.onload = () => {
    img.classList.add("loaded");
    box.classList.remove("loading");
  };
  img.onerror = () => box.classList.remove("loading"); // stay a plain gray box, stop pulsing
  if (url) img.src = url;
  else img.removeAttribute("src");
}

// YouTube pages: the title is already in the tab and the thumbnail URL follows from
// the video id, so show both immediately and enable MP3/WAV — the server's analysis
// (~3s, yt-dlp) then only fills in uploader + duration. A download clicked meanwhile
// simply waits on that same analysis server-side.
function showInstantPreview(url, tabTitle) {
  const id = extractMediaId(url);
  const title = (tabTitle || "")
    .replace(/^\(\d+\)\s*/, "") // "(3) " unread-notification prefix
    .replace(/\s*-\s*YouTube$/, "")
    .trim();
  if (!id || !title || title === "YouTube") return;

  els.thumbnail.removeAttribute("src");
  setThumbnail(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
  renderTrack(url, { title });
}

async function handleDownload(format) {
  if (!currentMedia) return;
  // Captured now: the user may load another link (paste) while this one converts.
  const media = currentMedia;
  const url = media.url;
  const cacheKey = currentCacheKey;
  linkGrid.setBusy(format);
  els.progress.classList.remove("hidden");
  els.progress.textContent = "Downloading and converting...";

  try {
    const res = await fetch(`${SERVER}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, format, ...(await getNormalizeOptions("link")) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    // The server's answer carries the authoritative title/uploader (the analysis shown on
    // screen may not have arrived yet); fall back to what's on screen.
    const title = data.title || (currentMedia?.url === url ? currentMedia.title : media.title);
    const { fileNameTemplate } = await getSettings();
    const filename = `${buildFileName(fileNameTemplate, { title, uploader: data.uploader })}.${format}`;
    const fileUrl = `${SERVER}${data.downloadUrl}`;

    const downloadId = await startDownload(fileUrl, filename, {
      source: "link",
      title: title || "instrumental",
      format,
      mediaUrl: url,
    });
    if (downloadId === null) {
      els.progress.textContent = "Save cancelled.";
      return;
    }

    els.progress.textContent = "Download started — check Chrome's downloads bar.";
    if (currentMedia?.url === url) {
      trackDownloadCompletion(downloadId, fileUrl, filename, els.btnTunebat, cacheKey);
    } else if (cacheKey) {
      // Another link is on screen now: still remember this download for its own page.
      chrome.storage.local.set({ [`pendingDownload:${downloadId}`]: { cacheKey, fileUrl, filename } });
    }
  } catch (err) {
    els.progress.textContent = `Error: ${withYtdlpHint(err.message)}`;
  } finally {
    linkGrid.setBusy(null);
  }
}

// Shows a Tunebat button once the file is actually finished saving (not just
// requested). Also persists it via the background worker (see background.js) so
// it still shows up if the popup gets closed and reopened before the download
// finishes. Shared by both the Link tab and the Sample tab.
function trackDownloadCompletion(downloadId, fileUrl, filename, buttonEl, cacheKey) {
  if (cacheKey) {
    chrome.storage.local.set({
      [`pendingDownload:${downloadId}`]: { cacheKey, fileUrl, filename },
    });
  }

  function onChanged(delta) {
    if (delta.id !== downloadId) return;
    if (delta.state && delta.state.current === "complete") {
      chrome.downloads.onChanged.removeListener(onChanged);
      updateTunebatButton(buttonEl, { fileUrl, filename, downloadId });
    } else if (delta.state && delta.state.current === "interrupted") {
      chrome.downloads.onChanged.removeListener(onChanged);
    }
  }
  chrome.downloads.onChanged.addListener(onChanged);
}

// Analysis card (BPM/key + rename) that sits under each Tunebat button; see analysis.js.
const analysisCardFor = new Map();

function updateTunebatButton(buttonEl, downloadedFile) {
  if (!downloadedFile) return;
  buttonEl.dataset.fileUrl = downloadedFile.fileUrl;
  buttonEl.dataset.filename = downloadedFile.filename;
  if (downloadedFile.downloadId) buttonEl.dataset.downloadId = downloadedFile.downloadId;
  else delete buttonEl.dataset.downloadId;
  buttonEl.classList.remove("hidden");
  analysisCardFor.get(buttonEl)?.refresh();
}

function makeTunebatHandler(buttonEl, progressEl) {
  return async function handleTunebatClick() {
    const fileUrl = buttonEl.dataset.fileUrl;
    const filename = buttonEl.dataset.filename;

    if (!fileUrl) {
      chrome.tabs.create({ url: TUNEBAT_URL });
      return;
    }

    const originalLabel = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "Opening Tunebat...";

    const response = await chrome.runtime.sendMessage({ type: "openInTunebat", fileUrl, filename });

    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;

    if (!response?.ok) {
      progressEl.classList.remove("hidden");
      progressEl.textContent = `Error opening Tunebat: ${response?.error || "unknown error"}`;
    }
  };
}

function getCachedBundle(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(`bundle:${key}`, (items) => {
      resolve(items[`bundle:${key}`] || null);
    });
  });
}

function setCachedBundle(key, bundle) {
  chrome.storage.local.set({ [`bundle:${key}`]: bundle });
}

