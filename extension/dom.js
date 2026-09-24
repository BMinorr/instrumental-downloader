// DOM handles, the format-button grid component and small UI helpers shared by all tabs.
// (Classic scripts sharing globals: see the note in CLAUDE.md before adding a global.)

const els = {
  statusMessage: document.getElementById("status-message"),
  trackInfo: document.getElementById("track-info"),
  thumbnail: document.getElementById("thumbnail"),
  trackTitle: document.getElementById("track-title"),
  trackMeta: document.getElementById("track-meta"),
  formatOptions: document.getElementById("format-options"),
  progress: document.getElementById("progress"),
  serverDot: document.getElementById("settings-server-dot"),
  btnTunebat: document.getElementById("btn-tunebat"),
  tabFile: document.getElementById("tab-file"),
  tabLink: document.getElementById("tab-link"),
  tabSample: document.getElementById("tab-sample"),
  panelFile: document.getElementById("panel-file"),
  panelLink: document.getElementById("panel-link"),
  panelSample: document.getElementById("panel-sample"),
  sampleStatus: document.getElementById("sample-status"),
  sampleResult: document.getElementById("sample-result"),
  sampleAudio: document.getElementById("sample-audio"),
  sampleFormatOptions: document.getElementById("sample-format-options"),
  sampleProgress: document.getElementById("sample-progress"),
  sampleBtnDiscard: document.getElementById("sample-btn-discard"),
  sampleTimer: document.getElementById("sample-timer"),
  sampleRecordBtn: document.getElementById("sample-record-btn"),
  sampleWaveform: document.getElementById("sample-waveform"),
  sampleFilename: document.getElementById("sample-filename"),
  sampleBtnTrimSilence: document.getElementById("sample-btn-trim-silence"),
  sampleFadeIn: document.getElementById("sample-fade-in"),
  sampleFadeOut: document.getElementById("sample-fade-out"),
  sampleLevelMeter: document.getElementById("sample-level-meter"),
  sampleLevelFill: document.getElementById("sample-level-fill"),
  samplePlayBtn: document.getElementById("sample-play-btn"),
  sampleBtnTunebat: document.getElementById("sample-btn-tunebat"),
  tabSettings: document.getElementById("tab-settings"),
  panelSettings: document.getElementById("panel-settings"),
  settingNormalizeLink: document.getElementById("setting-normalize-link"),
  settingNormalizeSample: document.getElementById("setting-normalize-sample"),
  settingNormalizeFile: document.getElementById("setting-normalize-file"),
  settingTargetLufs: document.getElementById("setting-target-lufs"),
  settingSaveAs: document.getElementById("setting-save-as"),
  settingSubfolder: document.getElementById("setting-subfolder"),
  settingStartTab: document.getElementById("setting-start-tab"),
  settingPrefetch: document.getElementById("setting-prefetch"),
  formatChips: document.getElementById("format-chips"),
  settingTags: document.getElementById("setting-tags"),
  settingFileName: document.getElementById("setting-file-name"),
  settingAnalysisName: document.getElementById("setting-analysis-name"),
  settingDeleteOriginal: document.getElementById("setting-delete-original"),
  tabQueue: document.getElementById("tab-queue"),
  panelQueue: document.getElementById("panel-queue"),
  queueInput: document.getElementById("queue-input"),
  queueFormat: document.getElementById("queue-format"),
  queueAdd: document.getElementById("queue-add"),
  queueMessage: document.getElementById("queue-message"),
  queueEmpty: document.getElementById("queue-empty"),
  queueSummary: document.getElementById("queue-summary"),
  queueList: document.getElementById("queue-list"),
  queueFooter: document.getElementById("queue-footer"),
  queueRetry: document.getElementById("queue-retry"),
  queueClearDone: document.getElementById("queue-clear-done"),
  queueClearAll: document.getElementById("queue-clear-all"),
  tabHistory: document.getElementById("tab-history"),
  panelHistory: document.getElementById("panel-history"),
  historyList: document.getElementById("history-list"),
  historyEmpty: document.getElementById("history-empty"),
  historyClear: document.getElementById("history-clear"),
  pasteInput: document.getElementById("paste-input"),
  pasteGo: document.getElementById("paste-go"),
  recordingShortcut: document.getElementById("recording-shortcut"),
  btnShortcuts: document.getElementById("btn-shortcuts"),
  ytdlpStatus: document.getElementById("ytdlp-status"),
  btnYtdlpUpdate: document.getElementById("btn-ytdlp-update"),
  appVersion: document.getElementById("app-version"),
  settingsServerText: document.getElementById("settings-server-text"),
  settingsBtnRecheck: document.getElementById("settings-btn-recheck"),
  settingsBtnClearCache: document.getElementById("settings-btn-clear-cache"),
  fileInput: document.getElementById("file-input"),
  fileDropzone: document.getElementById("file-dropzone"),
  fileDropzoneTitle: document.getElementById("file-dropzone-title"),
  fileDropzoneSub: document.getElementById("file-dropzone-sub"),
  fileDropzoneFormats: document.getElementById("file-dropzone-formats"),
  fileClear: document.getElementById("file-clear"),
  fileFormatOptions: document.getElementById("file-format-options"),
  fileProgress: document.getElementById("file-progress"),
  btnFileTunebat: document.getElementById("btn-file-tunebat"),
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
  for (const grid of [linkGrid, sampleGrid, fileGrid]) grid.setVisible(ids);
}

const linkGrid = createFormatGrid(els.formatOptions, (id) => handleDownload(id));
const sampleGrid = createFormatGrid(els.sampleFormatOptions, (id) => handleSampleDownload(id));
const fileGrid = createFormatGrid(els.fileFormatOptions, (id) => handleFileConvert(id));


function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}
