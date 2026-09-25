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

// The two-column table that shows what Tunebat found: BPM | Key. `state`: "idle" (nothing to
// analyze yet: empty cells), "pending" (a spinner in each cell while it's being analyzed), "done"
// (the values) or "failed" (dashes). No other text. It is on screen from the start.
function buildAnalysisTable(state, values = {}, { compact = false } = {}) {
  const table = document.createElement("table");
  table.className = `analysis-table${compact ? " compact" : ""}${state === "failed" ? " failed" : ""}`;
  const head = table.createTHead().insertRow();
  for (const label of ["BPM", "Key"]) head.appendChild(Object.assign(document.createElement("th"), { textContent: label }));
  const row = table.createTBody().insertRow();
  const content = {
    idle: ["", ""],
    pending: [null, null],
    failed: ["—", "—"],
    done: [values.bpm ? String(Math.round(values.bpm)) : "—", values.key || "—"],
  }[state];
  for (const text of content) fillCell(row.insertCell(), text);
  return table;
}

// A table cell: text, or (null) a loading spinner.
function fillCell(cell, text) {
  if (text === null) cell.appendChild(Object.assign(document.createElement("span"), { className: "spinner small" }));
  else cell.textContent = text;
}

// Reverb settings that fit a tempo — same maths as anotherproducer.com's Delay & Reverb calculator.
// One bar (4/4) lasts 240000 / bpm ms. Total reverb time = a note length of the bar; the pre-delay
// is a short fraction of the bar (1/32, 1/64, 1/128, 1/512) and the decay time is what remains.
// The pre-delay is shown in ms (2 decimals, like the site); the decay time in seconds, cut
// (not rounded) to 3 decimals: 3937.5 ms -> 3.937 s.
const REVERB_SIZES = [
  { name: "2 Bars", bars: 2, preDelayDiv: 32 }, // hall
  { name: "1 Bar", bars: 1, preDelayDiv: 64 }, // large room
  { name: "1/2 Note", bars: 1 / 2, preDelayDiv: 128 }, // small room
  { name: "1/4 Note", bars: 1 / 4, preDelayDiv: 512 }, // tight ambience
];

const roundMs = (ms) => parseFloat(ms.toFixed(2));

function reverbTimes(bpm) {
  const bar = 240000 / bpm;
  return REVERB_SIZES.map(({ name, bars, preDelayDiv }) => {
    const preDelay = bar / preDelayDiv;
    const decayMs = bar * bars - preDelay;
    return { name, preDelay: roundMs(preDelay), decay: (Math.floor(decayMs + 1e-6) / 1000).toFixed(3) };
  });
}

// Puts `text` on the clipboard and flashes "Copied" on the cell that was clicked.
async function copyFromCell(cell, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  cell.classList.add("copied");
  clearTimeout(cell.copyTimer);
  cell.copyTimer = setTimeout(() => cell.classList.remove("copied"), 700);
}

// Three columns: Reverb size | Pre-delay | Decay time. The sizes are always listed; the two
// value columns are empty (idle), spinners (pending), dashes (failed) or the numbers (done, needs
// the BPM). Every value cell copies its number (no unit, ready for a plugin field) on click.
function buildReverbTable(state, bpm, { compact = false } = {}) {
  const table = document.createElement("table");
  table.className = `analysis-table reverb-table${compact ? " compact" : ""}`;
  const head = table.createTHead().insertRow();
  for (const label of ["Reverb size", "Pre-delay", "Decay time"]) {
    head.appendChild(Object.assign(document.createElement("th"), { textContent: label }));
  }
  const values = state === "done" && bpm > 0 ? reverbTimes(bpm) : null;
  const placeholder = { idle: "", pending: null, failed: "—", done: "—" }[state];
  const body = table.createTBody();
  REVERB_SIZES.forEach(({ name }, i) => {
    const row = body.insertRow();
    row.insertCell().textContent = name;
    const cells = values
      ? [[`${values[i].preDelay} ms`, String(values[i].preDelay)], [`${values[i].decay} s`, values[i].decay]]
      : [[placeholder], [placeholder]];
    for (const [shown, copied] of cells) {
      const cell = row.insertCell();
      fillCell(cell, shown);
      if (copied !== undefined) {
        cell.className = "copyable";
        cell.title = "Click to copy";
        cell.addEventListener("click", () => copyFromCell(cell, copied));
      }
    }
  });
  return table;
}

// The reverb table that goes under an entry's BPM/Key table. History rows leave it out for a
// failed analysis (nothing to calculate, and the row is already busy).
function reverbTableFor(entry, options) {
  const state = entry && entry.analysis ? analysisState(entry) : "idle";
  if (options?.compact && state === "failed") return null;
  return buildReverbTable(state, entry?.bpm, options);
}

// "pending" | "done" | "failed" from an entry's `analysis` field (pending/analyzing both spin).
function analysisState(entry) {
  return entry.analysis === "done" ? "done" : entry.analysis === "failed" ? "failed" : "pending";
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

  if (entry.analysis) {
    info.appendChild(buildAnalysisTable(analysisState(entry), entry, { compact: true }));
    const reverb = reverbTableFor(entry, { compact: true });
    if (reverb) info.appendChild(reverb);
  }

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
    loadHistory().then((list) => {
      for (const card of resultCards) card.refresh(list); // one read for every card
    });
  });
}

// --- Result card: sits under a tab's format buttons ---
// `pick(list)` chooses which history entry the card describes (or none).
const resultCards = new Set();

function createResultCard(el, pick) {
  const card = {
    async refresh(list) {
      const entry = pick(list || (await loadHistory()));
      renderResultCard(el, entry, entry && (() => chrome.runtime.sendMessage({ type: "analysis:retry", historyId: entry.id })));
    },
  };
  resultCards.add(card);
  card.refresh();
  return card;
}

// Always on screen: empty cells before anything happened, spinners while it's being analyzed.
function renderResultCard(el, entry, onRetry) {
  el.replaceChildren();
  el.classList.remove("hidden");
  const state = entry && entry.analysis ? analysisState(entry) : "idle";
  el.appendChild(buildAnalysisTable(state, entry || {}));
  el.appendChild(reverbTableFor(entry));
  if (state === "failed" && onRetry) {
    const retry = iconButton(ICON_RETRY, "Try again", onRetry);
    retry.classList.add("result-retry");
    el.appendChild(retry);
  }
}
