// "Rename with BPM & key": after a file has been analyzed on Tunebat, background.js stores the
// result (see readTunebatResult); this shows it next to the Tunebat button — Link and Sample
// tabs, and History rows — and saves a copy named with it (tagged too, for MP3 and FLAC).
// Loaded before popup.js; `SERVER`, `startDownload`, `getSettings`, `getAnalysis` etc. are
// looked up at call time.

const analysisCards = new Set(); // every card currently in the popup, for live refresh

// getInfo() -> { fileUrl, filename, downloadId?, source, mediaUrl? } for the file the card
// belongs to (or null when there isn't one yet). setStatus(text) shows progress/errors.
function buildAnalysisCard(getInfo, setStatus) {
  const el = document.createElement("div");
  el.className = "analysis hidden";
  const text = document.createElement("span");
  text.className = "analysis-text";
  const button = document.createElement("button");
  button.className = "analysis-btn";
  button.textContent = "Rename with BPM & key";
  el.append(text, button);

  let current = null;
  async function refresh() {
    const info = getInfo();
    current = info?.fileUrl ? await getAnalysis(info.fileUrl) : null;
    el.classList.toggle("hidden", !current);
    if (!current) return;
    text.textContent = [`${Math.round(current.bpm)} BPM`, current.key, current.camelot].filter(Boolean).join(" · ");
  }
  button.addEventListener("click", async () => {
    const info = getInfo();
    if (!info || !current) return;
    button.disabled = true;
    try {
      await renameWithAnalysis(info, current, setStatus);
    } catch (err) {
      setStatus(err instanceof TypeError ? "Can't reach the local server." : `Error: ${err.message}`);
    } finally {
      button.disabled = false;
    }
  });

  const card = { el, refresh };
  analysisCards.add(card);
  refresh();
  return card;
}

async function renameWithAnalysis(info, analysis, setStatus) {
  const settings = await getSettings();
  const bare = info.filename.split("/").pop();
  const dot = bare.lastIndexOf(".");
  const ext = dot > 0 ? bare.slice(dot + 1).toLowerCase() : "";
  const base = dot > 0 ? bare.slice(0, dot) : bare;
  const name = buildAnalysisName(settings.analysisNameTemplate, {
    title: base,
    bpm: Math.round(analysis.bpm),
    key: analysis.key,
    keyshort: shortKey(analysis.key),
    camelot: analysis.camelot,
  });

  setStatus("Preparing the renamed copy…");
  let url = info.fileUrl;
  if (ext === "mp3" || ext === "flac") {
    // A copy with BPM and key written into its tags (a stream copy — instant, lossless).
    const res = await fetch(`${SERVER}/api/annotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: decodeURIComponent(info.fileUrl.split("/").pop()),
        bpm: analysis.bpm,
        key: shortKey(analysis.key) || analysis.key,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");
    url = `${SERVER}${data.downloadUrl}`;
  } else if (!(await fetch(url, { method: "HEAD" }).then((r) => r.ok, () => false))) {
    throw new Error("The server copy expired — download the file again first.");
  }

  const downloadId = await startDownload(url, `${name}.${ext}`, {
    source: info.source,
    title: name,
    format: ext,
    mediaUrl: info.mediaUrl,
  });
  if (downloadId === null) return setStatus("Save cancelled.");

  let note = "Saved.";
  if (settings.deleteOriginal && info.downloadId) {
    try {
      await chrome.downloads.removeFile(Number(info.downloadId));
      note = "Saved — the original file was deleted.";
    } catch {
      note = "Saved (couldn't delete the original — it may have been moved).";
    }
  }
  setStatus(note);
}

// Results arrive after the popup may already be open (Tunebat finished while it was closed
// and reopened, or a slow analysis): refresh every card when one is stored.
function initAnalysisUpdates() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.keys(changes).some((k) => k.startsWith(ANALYSIS_PREFIX))) return;
    for (const card of analysisCards) {
      if (card.el.isConnected) card.refresh();
      else analysisCards.delete(card);
    }
  });
}
