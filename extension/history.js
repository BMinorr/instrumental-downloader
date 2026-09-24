// History tab: the last downloads, with quick actions. Loaded before popup.js; everything
// here is called from popup.js after both scripts have loaded (it uses popup.js's `els`,
// `SERVER`, `FORMATS`, `createFormatGrid`, `getNormalizeOptions`, `startDownload` at call time).

const HISTORY_KEY = "history";
const HISTORY_MAX = 30;
const TUNEBAT_OK = ["mp3", "wav", "flac", "aac", "ogg", "m4a"]; // what Tunebat's uploader accepts

async function loadHistory() {
  const items = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(items[HISTORY_KEY]) ? items[HISTORY_KEY] : [];
}

// Called by startDownload() for every download that was actually started.
async function recordHistory(entry) {
  const list = await loadHistory();
  list.unshift({ ...entry, ts: Date.now() });
  await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, HISTORY_MAX) });
}

function relativeTime(ts) {
  const diff = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

const SOURCE_LABELS = { link: "Link", sample: "Sample", file: "File" };

const ICON_FOLDER =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const ICON_TUNEBAT =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 12 7 12 10 4 14 20 17 12 21 12"></polyline></svg>';
const ICON_CONVERT =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>';

async function renderHistory() {
  const list = await loadHistory();
  els.historyList.replaceChildren();
  els.historyEmpty.classList.toggle("hidden", list.length > 0);
  els.historyClear.classList.toggle("hidden", list.length === 0);
  for (const entry of list) els.historyList.appendChild(buildHistoryRow(entry));
}

function iconButton(html, title, onClick) {
  const button = document.createElement("button");
  button.className = "icon-btn neutral history-btn";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = html;
  button.addEventListener("click", onClick);
  return button;
}

function buildHistoryRow(entry) {
  const row = document.createElement("li");
  row.className = "history-item";

  const info = document.createElement("div");
  info.className = "history-info";
  const title = document.createElement("p");
  title.className = "history-title";
  title.textContent = entry.title || entry.filename;
  title.title = entry.filename;
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${entry.format.toUpperCase()} · ${SOURCE_LABELS[entry.source] || ""} · ${relativeTime(entry.ts)}`;
  info.append(title, meta);

  const status = document.createElement("p");
  status.className = "meta history-status hidden";
  const setStatus = (text) => {
    status.textContent = text;
    status.classList.toggle("hidden", !text);
  };

  const actions = document.createElement("div");
  actions.className = "history-actions";
  actions.appendChild(
    iconButton(ICON_FOLDER, "Show in folder", async () => {
      try {
        const [item] = await chrome.downloads.search({ id: entry.downloadId });
        if (!item || item.exists === false) return setStatus("The file was moved or deleted.");
        chrome.downloads.show(entry.downloadId);
      } catch {
        setStatus("Couldn't open the folder.");
      }
    })
  );

  const tunebatOk = TUNEBAT_OK.includes(entry.format);
  const tunebat = iconButton(
    ICON_TUNEBAT,
    tunebatOk ? "Analyze BPM & Key on Tunebat" : "Tunebat doesn't accept this format",
    () => historyTunebat(entry, tunebat, setStatus)
  );
  tunebat.disabled = !tunebatOk;
  actions.appendChild(tunebat);

  // Link downloads can be fetched again in any other format.
  let grid = null;
  if (entry.source === "link" && entry.mediaUrl) {
    const convertArea = document.createElement("div");
    convertArea.className = "format-grid history-formats hidden";
    grid = createFormatGrid(convertArea, (format) => historyConvert(entry, format, grid, setStatus));
    actions.appendChild(
      iconButton(ICON_CONVERT, "Download again in another format", () => {
        convertArea.classList.toggle("hidden");
        row.classList.toggle("open");
      })
    );
    row.append(info, actions, status, convertArea);
    getSettings().then((s) => grid.setVisible(s.formats));
  } else {
    row.append(info, actions, status);
  }
  return row;
}

// Opens the entry on Tunebat. The server keeps files for an hour; for older Link entries
// the file is fetched/converted again first, others can't be recovered.
async function historyTunebat(entry, button, setStatus) {
  button.disabled = true;
  setStatus("Preparing…");
  try {
    let fileUrl = entry.fileUrl;
    const alive = await fetch(fileUrl, { method: "HEAD" }).then((r) => r.ok, () => false);
    if (!alive) {
      if (entry.source !== "link" || !entry.mediaUrl) {
        setStatus("The server copy expired — download it again from its tab.");
        return;
      }
      setStatus("Fetching again…");
      const res = await fetch(`${SERVER}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: entry.mediaUrl, format: entry.format, ...(await getNormalizeOptions("link")) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unknown error.");
      fileUrl = `${SERVER}${data.downloadUrl}`;
    }
    setStatus("Opening Tunebat…");
    const filename = entry.filename.split("/").pop();
    const response = await chrome.runtime.sendMessage({ type: "openInTunebat", fileUrl, filename });
    setStatus(response?.ok ? "" : `Error: ${response?.error || "unknown error"}`);
  } catch (err) {
    setStatus(err instanceof TypeError ? "Can't reach the local server." : `Error: ${err.message}`);
  } finally {
    button.disabled = false;
  }
}

async function historyConvert(entry, format, grid, setStatus) {
  grid.setBusy(format);
  setStatus("Downloading and converting…");
  try {
    const res = await fetch(`${SERVER}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: entry.mediaUrl, format, ...(await getNormalizeOptions("link")) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");
    const { fileNameTemplate } = await getSettings();
    const base = buildFileName(fileNameTemplate, { title: data.title || entry.title, uploader: data.uploader });
    const downloadId = await startDownload(`${SERVER}${data.downloadUrl}`, `${base}.${format}`, {
      source: "link",
      title: entry.title,
      format,
      mediaUrl: entry.mediaUrl,
    });
    setStatus(downloadId === null ? "Save cancelled." : "Download started.");
    if (downloadId !== null) renderHistory();
  } catch (err) {
    setStatus(`Error: ${withYtdlpHint(err.message)}`);
  } finally {
    grid.setBusy(null);
  }
}

function initHistoryTab() {
  els.historyClear.addEventListener("click", async () => {
    await chrome.storage.local.remove(HISTORY_KEY);
    renderHistory();
  });
}
