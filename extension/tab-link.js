// Link tab: load a link (current tab or pasted), preview it and download it.

let currentCacheKey = null;
const batchGrid = createFormatGrid(els.batchFormatOptions, (id) => addBatchToQueue(id));
// What the automatic Tunebat analysis says about the link on screen (latest download of it).
const linkResultCard = createResultCard(els.linkResultCard, (history) =>
  currentMedia ? history.find((e) => e.mediaUrl === currentMedia.url) : null
);
// What the MP3/WAV buttons act on. Set by renderTrack (possibly twice for YouTube: first
// an instant preview built from the tab itself, then the server's authoritative data).
let currentMedia = null; // { url, title }

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
  els.batchCard.classList.add("hidden");
  els.trackInfo.classList.add("hidden");
  els.formatOptions.classList.add("hidden");
  els.progress.classList.add("hidden");
  els.progress.textContent = "";
  els.thumbnail.removeAttribute("src");
  linkResultCard.refresh();
}

// --- Paste row (Link tab) ---
// Paste one link and it loads with a preview; paste several (one per line) or a YouTube
// playlist and they become a batch: pick a format and the whole lot goes to the download
// queue, which runs in the background. Enter (or →) submits what's typed, Shift+Enter adds a
// line, an empty field + Enter goes back to the page in the current tab.

const PLAYLIST_LINK_RE =
  /^https?:\/\/(www\.|m\.)?youtube\.com\/(playlist\?(\S*&)?list=[\w-]+|watch\?(\S*&)?v=[\w-]{6,}\S*[&?]list=[\w-]+)/i;

function parseLinks(text) {
  const found = String(text).match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(found)];
}

let pendingBatch = null; // { items: [{url, title?, uploader?}], notes: [] } waiting for a format

function growPasteInput() {
  const el = els.pasteInput;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 92)}px`;
}

function initPasteRow() {
  els.pasteInput.addEventListener("input", growPasteInput);
  els.pasteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPaste();
    }
  });
  // Lets the pasted text land, then acts on it — so pasting is all it takes.
  els.pasteInput.addEventListener("paste", () => setTimeout(submitPaste, 0));
  els.pasteGo.addEventListener("click", submitPaste);

  els.queueRetry.addEventListener("click", () => sendToBackground({ type: "queue:retry" }));
  els.queueClearDone.addEventListener("click", () => sendToBackground({ type: "queue:clear", scope: "done" }));
  els.queueClearAll.addEventListener("click", () => sendToBackground({ type: "queue:clear", scope: "all" }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[QUEUE_KEY]) renderQueue();
  });
  renderQueue();

  // Nothing to load from the current tab -> the pasted link is the only thing to do here.
  if (detectPlatform(activeTabInfo.url) === "unknown") els.pasteInput.focus();
}

async function submitPaste() {
  const raw = els.pasteInput.value.trim();
  if (!raw) {
    loadLink(activeTabInfo.url, { tabTitle: activeTabInfo.title });
    return;
  }
  const urls = parseLinks(raw);
  els.pasteInput.value = urls.join("\n") || raw;
  growPasteInput();

  // One ordinary link: the usual preview + format buttons.
  if (urls.length === 1 && !PLAYLIST_LINK_RE.test(urls[0])) {
    loadLink(urls[0], { pasted: true });
    return;
  }
  if (!urls.length) {
    loadLink("", { pasted: true }); // shows the "doesn't look like a link" message
    return;
  }
  await prepareBatch(urls);
}

// Several links / a playlist: resolve playlists into their videos, then wait for a format.
async function prepareBatch(urls) {
  ++linkLoadId; // whatever single link was loading is abandoned
  resetLinkView();
  els.statusMessage.textContent = "Reading the links…";
  els.statusMessage.classList.remove("hidden");

  const items = [];
  const notes = [];
  let skipped = 0;
  for (const url of urls) {
    if (PLAYLIST_LINK_RE.test(url)) {
      try {
        const res = await fetch(`${SERVER}/api/playlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unknown error.");
        items.push(...data.items.map(({ url: itemUrl, title, uploader }) => ({ url: itemUrl, title, uploader })));
        if (data.truncated) notes.push(`Only the first ${data.items.length} videos of “${data.title}” were taken.`);
      } catch (err) {
        notes.push(err instanceof TypeError ? "Can't reach the local server." : `Couldn't read a playlist: ${withYtdlpHint(err.message)}`);
      }
    } else if (detectPlatform(url) !== "unknown") {
      items.push({ url });
    } else {
      skipped++;
    }
  }
  if (skipped) notes.push(`${skipped} link${skipped > 1 ? "s" : ""} skipped (not YouTube, Spotify or Instagram).`);

  if (!items.length) {
    els.statusMessage.textContent = notes.join(" ") || "Nothing to add.";
    return;
  }
  pendingBatch = { items, notes };
  els.statusMessage.textContent = notes.join(" ");
  els.statusMessage.classList.toggle("hidden", notes.length === 0);
  els.batchSummary.textContent = `${items.length} track${items.length > 1 ? "s" : ""} ready`;
  els.batchCard.classList.remove("hidden");
}

async function addBatchToQueue(format) {
  if (!pendingBatch) return;
  const { items } = pendingBatch;
  batchGrid.setBusy(format);
  try {
    const response = await sendToBackground({ type: "queue:add", items, format });
    if (!response?.ok) throw new Error(response?.error || "Unknown error.");
    const already = items.length - response.added;
    els.pasteInput.value = "";
    growPasteInput();
    pendingBatch = null;
    els.batchCard.classList.add("hidden");
    els.statusMessage.textContent =
      `Added ${response.added} to the queue — it keeps going with this window closed.` +
      (already > 0 ? ` ${already} already in the queue.` : "");
    els.statusMessage.classList.remove("hidden");
  } catch (err) {
    els.statusMessage.textContent = `Error: ${err.message}`;
    els.statusMessage.classList.remove("hidden");
  } finally {
    batchGrid.setBusy(null);
  }
}

// --- Queue list (under the Link tab) ---

const QUEUE_ICONS = {
  queued: '<span class="queue-dot"></span>',
  working: '<span class="spinner small"></span>',
  done:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="13"></line><circle cx="12" cy="16.5" r="0.6"></circle></svg>',
};
const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const RETRY_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';

async function renderQueue() {
  const items = (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || [];
  const count = (status) => items.filter((i) => i.status === status).length;
  const pending = count("queued") + count("working");

  els.queueSection.classList.toggle("hidden", items.length === 0);
  els.tabLink.classList.toggle("has-activity", pending > 0);
  els.queueList.replaceChildren();
  els.queueRetry.classList.toggle("hidden", count("error") === 0);
  els.queueClearDone.classList.toggle("hidden", count("done") === 0);
  els.queueSummary.textContent = items.length
    ? `Queue · ${count("done")} of ${items.length} done${count("error") ? ` · ${count("error")} failed` : ""}${pending ? " · working…" : ""}`
    : "";

  for (const item of items) {
    const row = document.createElement("li");
    row.className = `queue-item queue-${item.status}`;

    const icon = document.createElement("span");
    icon.className = "queue-icon";
    icon.innerHTML = QUEUE_ICONS[item.status] || "";

    const info = document.createElement("div");
    info.className = "history-info";
    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = item.title || item.url.replace(/^https?:\/\/(www\.)?/, "");
    title.title = item.url;
    const meta = document.createElement("p");
    meta.className = "meta queue-meta";
    const analysis = analysisSummary(item);
    const detail =
      item.status === "error" ? item.error
      : item.status === "working" ? item.step
      : item.status === "queued" ? "Waiting"
      : item.analysis === "done" && analysis ? analysis
      : item.analysis === "pending" || item.analysis === "analyzing" ? "Saved · analyzing BPM & key…"
      : "Saved";
    meta.textContent = `${item.format.toUpperCase()} · ${detail}`;
    info.append(title, meta);

    row.append(icon, info);
    if (item.status === "error") {
      row.appendChild(iconButton(RETRY_ICON, "Retry", () => sendToBackground({ type: "queue:retry", id: item.id })));
    }
    if (item.status !== "working") {
      row.appendChild(iconButton(REMOVE_ICON, "Remove", () => sendToBackground({ type: "queue:remove", id: item.id })));
    }
    els.queueList.appendChild(row);
  }
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
  currentMedia = { url: mediaUrl, title: data.title, uploader: data.uploader };

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
  linkResultCard.refresh();
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
    // screen may not have arrived yet); fall back to what's on screen. BPM/key aren't known
    // yet — the background worker re-saves the file under its final name after Tunebat.
    const title = data.title || (currentMedia?.url === url ? currentMedia.title : media.title) || "instrumental";
    const producer = data.uploader ?? media.uploader ?? "";
    const settings = await getSettings();
    const filename = `${buildName(settings, { title, producer, format })}.${format}`;

    const downloadId = await startDownload(`${SERVER}${data.downloadUrl}`, filename, {
      source: "link",
      title,
      producer,
      format,
      mediaUrl: url,
    });
    els.progress.textContent =
      downloadId === null
        ? "Save cancelled."
        : settings.analyze
          ? "Saved — analyzing BPM & key on Tunebat in the background."
          : "Download started — check Chrome's downloads bar.";
    linkResultCard.refresh();
  } catch (err) {
    els.progress.textContent = `Error: ${withYtdlpHint(err.message)}`;
  } finally {
    linkGrid.setBusy(null);
  }
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

