// History tab + the result card shown under the format buttons: the last downloads and,
// for each, what the automatic Tunebat analysis found (BPM, key) or is doing.

async function renderHistory() {
  const list = await loadHistory();
  els.historyList.replaceChildren();
  els.historyEmpty.classList.toggle("hidden", list.length > 0);
  els.historyClear.classList.toggle("hidden", list.length === 0);
  for (const entry of list) els.historyList.appendChild(buildHistoryRow(entry));
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
const ICON_CONVERT =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>';
const ICON_RETRY =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';

function iconButton(html, title, onClick) {
  const button = document.createElement("button");
  button.className = "icon-btn neutral history-btn";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = html;
  button.addEventListener("click", onClick);
  return button;
}

// "140 BPM · A minor · 8A" (whatever is known).
function analysisSummary(entry) {
  return [entry.bpm ? `${Math.round(entry.bpm)} BPM` : "", entry.key, entry.camelot].filter(Boolean).join(" · ");
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

  // What the automatic analysis says about this file.
  const analysis = document.createElement("p");
  analysis.className = "meta history-analysis-line";
  const summary = analysisSummary(entry);
  if (entry.analysis === "done" && summary) {
    analysis.textContent = summary;
    analysis.classList.add("done");
  } else if (entry.analysis === "pending" || entry.analysis === "analyzing") {
    analysis.textContent = "Analyzing on Tunebat…";
  } else if (entry.analysis === "failed") {
    analysis.textContent = "BPM & key unavailable";
    analysis.classList.add("failed");
  }
  if (analysis.textContent) info.appendChild(analysis);

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

  if (entry.analysis === "failed") {
    actions.appendChild(
      iconButton(ICON_RETRY, "Analyze again", async () => {
        setStatus("Analyzing again…");
        const response = await chrome.runtime.sendMessage({ type: "analysis:retry", historyId: entry.id });
        if (!response?.ok) setStatus("The server copy expired — download it again.");
      })
    );
  }

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
    const settings = await getSettings();
    const title = data.title || entry.title;
    const producer = data.uploader ?? entry.producer;
    const downloadId = await startDownload(`${SERVER}${data.downloadUrl}`, `${buildName(settings, { title, producer, format })}.${format}`, {
      source: "link",
      title,
      producer,
      format,
      mediaUrl: entry.mediaUrl,
    });
    setStatus(downloadId === null ? "Save cancelled." : "Download started.");
  } catch (err) {
    setStatus(`Error: ${withYtdlpHint(err.message)}`);
  } finally {
    grid.setBusy(null);
  }
}

function initHistoryTab() {
  els.historyClear.addEventListener("click", async () => {
    await withHistoryLock(() => chrome.storage.local.remove(HISTORY_KEY));
  });
  // Live: a Tunebat result arriving (or a new download) updates rows and cards at once.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[HISTORY_KEY]) return;
    if (!els.panelHistory.classList.contains("hidden")) renderHistory();
    for (const card of resultCards) card.refresh();
  });
}

// --- Result card: sits under a tab's format buttons ---
// `pick(list)` chooses which history entry the card describes (or none).
const resultCards = new Set();

function createResultCard(el, pick) {
  const card = {
    async refresh() {
      const entry = pick(await loadHistory());
      renderResultCard(el, entry);
    },
  };
  resultCards.add(card);
  card.refresh();
  return card;
}

function renderResultCard(el, entry) {
  el.replaceChildren();
  el.classList.toggle("hidden", !entry || !entry.analysis);
  if (!entry || !entry.analysis) return;

  const line = document.createElement("p");
  line.className = "result-line";
  const sub = document.createElement("p");
  sub.className = "meta";

  if (entry.analysis === "pending" || entry.analysis === "analyzing") {
    const spinner = document.createElement("span");
    spinner.className = "spinner small";
    line.append(spinner, " Analyzing BPM & key on Tunebat…");
    sub.textContent = "Saved. The file gets renamed when the analysis is done.";
  } else if (entry.analysis === "done") {
    line.textContent = analysisSummary(entry) || "Analysis done";
    line.classList.add("done");
    sub.textContent = `Saved as “${entry.filename.split("/").pop()}”`;
  } else {
    line.textContent = "Couldn't get BPM & key from Tunebat";
    line.classList.add("failed");
    sub.textContent = "The file was kept as first saved.";
    const retry = document.createElement("button");
    retry.className = "analysis-btn";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => chrome.runtime.sendMessage({ type: "analysis:retry", historyId: entry.id }));
    el.append(line, sub, retry);
    return;
  }
  el.append(line, sub);
}
