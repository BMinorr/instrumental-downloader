// DOM handles, the format-button grid component and small UI helpers shared by all tabs.
// (Classic scripts sharing globals: see the note in CLAUDE.md before adding a global.)

const $ = (id) => document.getElementById(id);

const els = {
  // header / tabs
  tabsBar: $("tabs"),
  tabFile: $("tab-file"),
  tabLink: $("tab-link"),
  tabSample: $("tab-sample"),
  tabHistory: $("tab-history"),
  tabSettings: $("tab-settings"),
  panelFile: $("panel-file"),
  panelLink: $("panel-link"),
  panelSample: $("panel-sample"),
  panelHistory: $("panel-history"),
  panelSettings: $("panel-settings"),

  // Link
  pasteInput: $("paste-input"),
  pasteGo: $("paste-go"),
  statusMessage: $("status-message"),
  batchCard: $("batch-card"),
  batchSummary: $("batch-summary"),
  batchFormatOptions: $("batch-format-options"),
  trackInfo: $("track-info"),
  thumbnail: $("thumbnail"),
  trackTitle: $("track-title"),
  trackMeta: $("track-meta"),
  formatOptions: $("format-options"),
  progress: $("progress"),
  linkResultCard: $("link-result-card"),
  queueSection: $("queue-section"),
  queueSummary: $("queue-summary"),
  queueList: $("queue-list"),
  queueRetry: $("queue-retry"),
  queueClearDone: $("queue-clear-done"),
  queueClearAll: $("queue-clear-all"),

  // File
  fileInput: $("file-input"),
  fileDropzone: $("file-dropzone"),
  fileDropzoneTitle: $("file-dropzone-title"),
  fileDropzoneSub: $("file-dropzone-sub"),
  fileDropzoneFormats: $("file-dropzone-formats"),
  fileClear: $("file-clear"),
  fileFormatOptions: $("file-format-options"),
  fileProgress: $("file-progress"),
  fileResultCard: $("file-result-card"),

  // Sample
  sampleStatus: $("sample-status"),
  sampleResult: $("sample-result"),
  sampleAudio: $("sample-audio"),
  sampleFormatOptions: $("sample-format-options"),
  sampleProgress: $("sample-progress"),
  sampleBtnDiscard: $("sample-btn-discard"),
  sampleTimer: $("sample-timer"),
  sampleRecordBtn: $("sample-record-btn"),
  sampleWaveform: $("sample-waveform"),
  sampleFilename: $("sample-filename"),
  sampleBtnTrimSilence: $("sample-btn-trim-silence"),
  sampleFadeIn: $("sample-fade-in"),
  sampleFadeOut: $("sample-fade-out"),
  sampleLevelMeter: $("sample-level-meter"),
  sampleLevelFill: $("sample-level-fill"),
  samplePlayBtn: $("sample-play-btn"),
  sampleResultCard: $("sample-result-card"),

  // History
  historyList: $("history-list"),
  historyEmpty: $("history-empty"),
  historyClear: $("history-clear"),

  // Settings
  serverDot: $("settings-server-dot"),
  settingsServerText: $("settings-server-text"),
  settingsBtnRecheck: $("settings-btn-recheck"),
  settingsBtnClearCache: $("settings-btn-clear-cache"),
  settingNormalizeLink: $("setting-normalize-link"),
  settingNormalizeSample: $("setting-normalize-sample"),
  settingNormalizeFile: $("setting-normalize-file"),
  settingTargetLufs: $("setting-target-lufs"),
  settingSaveAs: $("setting-save-as"),
  settingSubfolder: $("setting-subfolder"),
  settingStartTab: $("setting-start-tab"),
  settingPrefetch: $("setting-prefetch"),
  settingTags: $("setting-tags"),
  settingAnalyze: $("setting-analyze"),
  settingDeleteOriginal: $("setting-delete-original"),
  settingCloseTunebat: $("setting-close-tunebat"),
  settingNameSeparator: $("setting-name-separator"),
  settingNameCustom: $("setting-name-custom"),
  nameCustomRow: $("name-custom-row"),
  nameUsed: $("name-used"),
  nameAvailable: $("name-available"),
  namePreview: $("name-preview"),
  tabsList: $("tabs-list"),
  formatChips: $("format-chips"),
  recordingShortcut: $("recording-shortcut"),
  btnShortcuts: $("btn-shortcuts"),
  ytdlpStatus: $("ytdlp-status"),
  btnYtdlpUpdate: $("btn-ytdlp-update"),
  appVersion: $("app-version"),
};

// Fills `container` with one button per format. Picking a format calls `onPick(id)`.
// Returns controls shared by all three tabs:
//   setLoading(on) — data not ready yet: every button shows a spinner and is disabled
//   setBusy(id|null) — a conversion is running: only that button spins, all are disabled
function createFormatGrid(container, onPick) {
  const buttons = new Map();
  for (const format of FORMATS) {
    const button = document.createElement("button");
    button.className = "format-btn";
    button.title = format.title;
    button.innerHTML =
      '<span class="spinner"></span><span class="btn-label"></span><span class="btn-sub"></span>';
    button.querySelector(".btn-label").textContent = format.label;
    button.querySelector(".btn-sub").textContent = format.sub;
    button.addEventListener("click", () => onPick(format.id));
    container.appendChild(button);
    buttons.set(format.id, button);
  }
  return {
    setLoading(on) {
      for (const button of buttons.values()) {
        button.classList.toggle("loading", on);
        button.disabled = on;
      }
    },
    setBusy(activeId) {
      for (const [id, button] of buttons) {
        button.classList.toggle("loading", id === activeId);
        button.disabled = activeId !== null;
      }
    },
    // Show only these formats (Settings > Formats shown); columns shrink to fit.
    setVisible(ids) {
      let count = 0;
      for (const [id, button] of buttons) {
        const shown = ids.includes(id);
        button.classList.toggle("hidden", !shown);
        if (shown) count++;
      }
      container.style.setProperty("--cols", String(Math.max(1, Math.min(3, count))));
    },
  };
}

function applyVisibleFormats(ids) {
  for (const grid of [linkGrid, sampleGrid, fileGrid, batchGrid]) grid.setVisible(ids);
}

const linkGrid = createFormatGrid(els.formatOptions, (id) => handleDownload(id));
const sampleGrid = createFormatGrid(els.sampleFormatOptions, (id) => handleSampleDownload(id));
const fileGrid = createFormatGrid(els.fileFormatOptions, (id) => handleFileConvert(id));


function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

// --- Drag & drop reordering (Settings: tabs, file-name blocks) ---
// Makes the children of each container in `containers` draggable between those containers.
// `onChange()` fires after every drop; items keep a `data-id`. Dropping onto a container's
// empty space appends; onto an item, inserts before it.
function makeSortable(containers, onChange) {
  let dragged = null;

  for (const container of containers) {
    container.addEventListener("dragover", (e) => {
      if (!dragged) return;
      e.preventDefault();
      container.classList.add("drag-over");
      const after = [...container.children].find((child) => {
        if (child === dragged) return false;
        const box = child.getBoundingClientRect();
        // Same row (chips wrap): compare horizontally; stacked rows (list): vertically.
        const stacked = getComputedStyle(container).flexDirection === "column" || container.tagName === "UL";
        return stacked ? e.clientY < box.top + box.height / 2 : e.clientY < box.bottom && e.clientX < box.left + box.width / 2;
      });
      if (after) container.insertBefore(dragged, after);
      else container.appendChild(dragged);
    });
    container.addEventListener("dragleave", (e) => {
      if (!container.contains(e.relatedTarget)) container.classList.remove("drag-over");
    });
    container.addEventListener("drop", (e) => {
      e.preventDefault();
      for (const c of containers) c.classList.remove("drag-over");
      onChange();
    });
  }

  return {
    // Call for every item added to a container (also after re-rendering).
    attach(item) {
      item.draggable = true;
      item.addEventListener("dragstart", (e) => {
        dragged = item;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.dataset.id || ""); // Firefox needs data to start a drag
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        dragged = null;
        for (const c of containers) c.classList.remove("drag-over");
        onChange(); // also covers a drop that landed outside every container
      });
    },
  };
}
