// --- Settings tab ---

// One toggle chip per format; at least one must stay on. Changes apply to the grids at once.
function buildFormatChips(selected) {
  const chips = new Map();
  for (const format of FORMATS) {
    const label = document.createElement("label");
    label.className = "chip";
    label.title = format.title;
    label.innerHTML = '<input type="checkbox" /><span></span>';
    label.querySelector("span").textContent = format.label;
    const input = label.querySelector("input");
    input.checked = selected.includes(format.id);
    input.addEventListener("change", () => {
      const ids = FORMATS.map((f) => f.id).filter((id) => chips.get(id).checked);
      if (!ids.length) {
        input.checked = true; // keep at least one format available
        return;
      }
      chrome.storage.local.set({ [SETTING_KEYS.formats]: ids });
      applyVisibleFormats(ids);
    });
    chips.set(format.id, input);
    els.formatChips.appendChild(label);
  }
}

// --- yt-dlp version / update (Settings) ---

let ytdlpChecked = false;

async function refreshYtdlpStatus(force = false) {
  if (ytdlpChecked && !force) return;
  ytdlpChecked = true;
  els.btnYtdlpUpdate.classList.add("hidden");
  els.ytdlpStatus.textContent = "Checking…";
  try {
    const res = await fetch(`${SERVER}/api/ytdlp`);
    const info = await res.json();
    if (!res.ok) throw new Error(info.error || "Unknown error.");
    showYtdlpStatus(info);
  } catch (err) {
    ytdlpChecked = false; // try again next time Settings opens
    els.ytdlpStatus.textContent = err instanceof TypeError ? "Server not connected" : `Error: ${err.message}`;
  }
}

function showYtdlpStatus(info) {
  const version = `v${info.version}`;
  if (info.updateAvailable) {
    els.ytdlpStatus.textContent = `${version} · update available (${info.latest})`;
  } else if (info.latest) {
    els.ytdlpStatus.textContent = `${version} · up to date`;
  } else {
    els.ytdlpStatus.textContent = `${version} · couldn't check for updates`;
  }
  // Offer the update when there is one — or when we couldn't tell (offline check).
  els.btnYtdlpUpdate.classList.toggle("hidden", !info.updateAvailable && !!info.latest);
}

async function updateYtdlp() {
  const button = els.btnYtdlpUpdate;
  button.disabled = true;
  els.ytdlpStatus.textContent = "Updating… this can take a minute";
  try {
    const res = await fetch(`${SERVER}/api/ytdlp/update`, { method: "POST" });
    const info = await res.json();
    if (!res.ok) throw new Error(info.error || "Unknown error.");
    showYtdlpStatus(info);
  } catch (err) {
    els.ytdlpStatus.textContent = `Update failed: ${err.message.split("\n").pop().slice(0, 90)}`;
  } finally {
    button.disabled = false;
  }
}

// Shows the key currently bound to "toggle recording" (users can change it in Chrome).
async function showRecordingShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((c) => c.name === "toggle-recording");
    els.recordingShortcut.textContent = command?.shortcut || "not set";
  } catch {
    els.recordingShortcut.textContent = "Alt+Shift+R";
  }
}

async function initSettingsTab() {
  const settings = await getSettings();

  els.settingNormalizeLink.checked = settings.normalize.link;
  els.settingNormalizeSample.checked = settings.normalize.sample;
  els.settingNormalizeFile.checked = settings.normalize.file;
  els.settingTargetLufs.value = String(settings.targetLufs);
  els.settingSaveAs.checked = settings.saveAs;
  els.settingSubfolder.value = settings.subfolder;
  els.settingStartTab.value = settings.startTab;
  els.settingPrefetch.checked = settings.prefetch;
  els.settingTags.checked = settings.tags;
  els.settingFileName.value = settings.fileNameTemplate === "{title}" ? "" : settings.fileNameTemplate;
  els.settingAnalysisName.value = settings.analysisNameTemplate === DEFAULT_ANALYSIS_TEMPLATE ? "" : settings.analysisNameTemplate;
  els.settingDeleteOriginal.checked = settings.deleteOriginal;
  buildFormatChips(settings.formats);

  const checkbox = (el) => () => el.checked;
  const value = (el) => () => el.value;
  const bindings = [
    [els.settingNormalizeLink, SETTING_KEYS.normalizeLink, "change", checkbox(els.settingNormalizeLink)],
    [els.settingNormalizeSample, SETTING_KEYS.normalizeSample, "change", checkbox(els.settingNormalizeSample)],
    [els.settingNormalizeFile, SETTING_KEYS.normalizeFile, "change", checkbox(els.settingNormalizeFile)],
    [els.settingTargetLufs, SETTING_KEYS.targetLufs, "change", () => Number(els.settingTargetLufs.value)],
    [els.settingSaveAs, SETTING_KEYS.saveAs, "change", checkbox(els.settingSaveAs)],
    [els.settingSubfolder, SETTING_KEYS.subfolder, "input", () => els.settingSubfolder.value.trim()],
    [els.settingStartTab, SETTING_KEYS.startTab, "change", value(els.settingStartTab)],
    [els.settingPrefetch, SETTING_KEYS.prefetch, "change", checkbox(els.settingPrefetch)],
    [els.settingTags, SETTING_KEYS.tags, "change", checkbox(els.settingTags)],
    [els.settingAnalysisName, SETTING_KEYS.analysisNameTemplate, "input", () => els.settingAnalysisName.value.trim() || DEFAULT_ANALYSIS_TEMPLATE],
    [els.settingDeleteOriginal, SETTING_KEYS.deleteOriginal, "change", checkbox(els.settingDeleteOriginal)],
    [els.settingFileName, SETTING_KEYS.fileNameTemplate, "input", () => els.settingFileName.value.trim() || "{title}"],
  ];
  for (const [el, key, eventName, read] of bindings) {
    el.addEventListener(eventName, () => chrome.storage.local.set({ [key]: read() }));
  }

  showRecordingShortcut();
  els.btnShortcuts.addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
  els.appVersion.textContent = chrome.runtime.getManifest?.().version || els.appVersion.textContent;
  els.settingsBtnRecheck.addEventListener("click", () => {
    checkServer();
    refreshYtdlpStatus(true);
  });
  els.btnYtdlpUpdate.addEventListener("click", updateYtdlp);
  els.settingsBtnClearCache.addEventListener("click", handleClearCache);
}

async function handleClearCache() {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter((k) => !k.startsWith("settings.") && k !== HISTORY_KEY);
  if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);

  const original = els.settingsBtnClearCache.textContent;
  els.settingsBtnClearCache.textContent = "Cleared!";
  setTimeout(() => {
    els.settingsBtnClearCache.textContent = original;
  }, 1500);
}

