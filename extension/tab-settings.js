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

// --- Updates: this tool (git) and yt-dlp ---

const UPDATE_CHECK_KEY = "updateCheck"; // { at, available } from the last check, for the dot on the gear
const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
let updatesChecked = false;

// The dot on the Settings gear: something (this tool or yt-dlp) has a newer version.
function showUpdateDot(available) {
  els.tabSettings.classList.toggle("update", available);
  if (!els.tabSettings.classList.contains("alert")) {
    els.tabSettings.title = available ? "Settings — update available" : "Settings";
  }
}

async function fetchJson(path, options) {
  const res = await fetch(`${SERVER}${path}`, options);
  const info = await res.json();
  if (!res.ok) throw new Error(info.error || "Unknown error.");
  return info;
}

// Reads both statuses (with the network check unless `check` is false), fills the two rows and
// remembers whether anything is available. `force` = ignore "already checked in this popup".
async function refreshUpdates({ force = false, check = true } = {}) {
  if (updatesChecked && !force) return;
  updatesChecked = true;
  els.btnAppUpdate.classList.add("hidden");
  els.btnYtdlpUpdate.classList.add("hidden");
  els.appUpdateStatus.textContent = "Checking…";
  els.ytdlpStatus.textContent = "Checking…";
  const query = check ? "" : "?check=0";
  const [app, ytdlp] = await Promise.allSettled([fetchJson(`/api/app${query}`), fetchJson(`/api/ytdlp${query}`)]);
  if (app.status === "rejected" && ytdlp.status === "rejected") updatesChecked = false; // try again next time Settings opens
  showAppStatus(app);
  showYtdlpStatus(ytdlp);
  if (check) {
    const available = app.value?.updateAvailable === true || ytdlp.value?.updateAvailable === true;
    chrome.storage.local.set({ [UPDATE_CHECK_KEY]: { at: Date.now(), available } });
    showUpdateDot(available);
  }
}

function failureText(result) {
  const err = result.reason;
  return err instanceof TypeError ? "Server not connected" : `Error: ${err.message}`;
}

function showAppStatus(result) {
  if (result.status === "rejected") {
    els.appUpdateStatus.textContent = failureText(result);
    return;
  }
  const info = result.value;
  const version = `v${info.version}${info.commit ? ` (${info.commit})` : ""}`;
  if (info.method === "manual") {
    els.appUpdateStatus.textContent = `${version} · installed without Git, update it by hand`;
  } else if (info.updateAvailable) {
    els.appUpdateStatus.textContent = `${version} · update available${info.latest ? `: ${info.latest}` : ""}`;
  } else if (info.checked) {
    els.appUpdateStatus.textContent = `${version} · up to date`;
  } else {
    els.appUpdateStatus.textContent = `${version} · not checked`;
  }
  els.btnAppUpdate.classList.toggle("hidden", !info.updateAvailable);
}

function showYtdlpStatus(result) {
  if (result.status === "rejected") {
    els.ytdlpStatus.textContent = failureText(result);
    return;
  }
  const info = result.value;
  const version = `v${info.version}`;
  if (info.updateAvailable) {
    els.ytdlpStatus.textContent = `${version} · update available (${info.latest})`;
  } else if (info.checked) {
    els.ytdlpStatus.textContent = `${version} · up to date`;
  } else {
    els.ytdlpStatus.textContent = `${version} · not checked`;
  }
  // Offer the update when there is one, or when a check was possible but failed while online.
  els.btnYtdlpUpdate.classList.toggle("hidden", !info.updateAvailable);
}

async function updateYtdlp() {
  const button = els.btnYtdlpUpdate;
  button.disabled = true;
  els.ytdlpStatus.textContent = "Updating… this can take a minute";
  try {
    const info = await fetchJson("/api/ytdlp/update", { method: "POST" });
    showYtdlpStatus({ status: "fulfilled", value: info });
    refreshUpdates({ force: true }); // recompute the dot
  } catch (err) {
    els.ytdlpStatus.textContent = `Update failed: ${err.message.split("\n").pop().slice(0, 90)}`;
  } finally {
    button.disabled = false;
  }
}

// Pulls the new version, and — when the extension's own files changed — reloads the extension
// (this popup closes). The server restarts itself first if its code changed.
async function updateApp() {
  const button = els.btnAppUpdate;
  button.disabled = true;
  els.appUpdateStatus.textContent = "Updating… this can take a minute";
  try {
    const result = await fetchJson("/api/app/update", { method: "POST" });
    if (!result.updated) {
      els.appUpdateStatus.textContent = "Already up to date";
    } else if (result.extensionChanged) {
      els.appUpdateStatus.textContent = "Updated — reloading the extension…";
      setTimeout(() => chrome.runtime.reload(), result.restarting ? 3500 : 1200);
    } else {
      els.appUpdateStatus.textContent = "Updated";
    }
    if (result.restarting) setTimeout(checkServer, 3500);
    button.classList.add("hidden");
    showUpdateDot(false);
    chrome.storage.local.set({ [UPDATE_CHECK_KEY]: { at: Date.now(), available: false } });
  } catch (err) {
    els.appUpdateStatus.textContent = `Update failed: ${err.message.split("\n").pop().slice(0, 90)}`;
  } finally {
    button.disabled = false;
  }
}

// Called when the popup opens: shows the dot from the last check and, when auto-check is on
// and the last check is old, looks again in the background.
async function startupUpdateCheck() {
  const settings = await getSettings();
  const { [UPDATE_CHECK_KEY]: last } = await chrome.storage.local.get(UPDATE_CHECK_KEY);
  showUpdateDot(settings.autoUpdateCheck && !!last?.available);
  if (settings.autoUpdateCheck && (!last || Date.now() - last.at > UPDATE_CHECK_EVERY_MS)) refreshUpdates(); // no-op if Settings already checked
}

// Opening Settings shows the current versions; with auto-check off nothing goes to the network.
async function onSettingsOpened() {
  const settings = await getSettings();
  refreshUpdates({ check: settings.autoUpdateCheck });
}

// --- Tips: a small "i" after an option's name reveals a one-or-two-sentence explanation ---

function initTips() {
  for (const row of els.panelSettings.querySelectorAll("[data-tip]")) {
    const tip = document.createElement("p");
    tip.className = "meta tip hidden";
    tip.textContent = row.dataset.tip;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "info-btn";
    button.textContent = "i";
    button.title = "What is this?";
    button.setAttribute("aria-label", `What is this? ${row.dataset.tip}`);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault(); // inside a <label>: don't flip the switch
      event.stopPropagation();
      const open = tip.classList.toggle("hidden") === false;
      button.classList.toggle("open", open);
      button.setAttribute("aria-expanded", String(open));
    });
    row.firstElementChild.appendChild(button);
    row.after(tip);
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

// --- Tabs: reorder + show/hide ---

function buildTabsList(settings) {
  els.tabsList.replaceChildren();
  // Left-hand tabs can be dragged into any order; History always sits on the right (switch only).
  const ids = [...settings.tabOrder.filter((id) => TABS.find((t) => t.id === id).side === "left"), ...TABS.filter((t) => t.side === "right").map((t) => t.id)];
  for (const id of ids) {
    const tab = TABS.find((t) => t.id === id);
    const item = document.createElement("li");
    item.className = "tab-item";
    item.dataset.id = id;
    item.innerHTML =
      `<span class="grip" aria-hidden="true">${tab.side === "left" ? "⋮⋮" : ""}</span><span class="tab-item-label"></span>` +
      '<span class="switch"><input type="checkbox" /><span class="switch-track"></span></span>';
    item.querySelector(".tab-item-label").textContent = tab.side === "left" ? tab.label : `${tab.label} (right side)`;
    const toggle = item.querySelector("input");
    toggle.checked = settings.visibleTabs.includes(id);
    toggle.addEventListener("change", () => {
      // Never hide the last visible tab.
      if (!els.tabsList.querySelector("input:checked")) toggle.checked = true;
      saveTabSettings();
    });
    if (tab.side === "left") tabsSortable.attach(item);
    els.tabsList.appendChild(item);
  }
}

const tabsSortable = makeSortable([els.tabsList], () => saveTabSettings());

async function saveTabSettings() {
  const items = [...els.tabsList.children];
  await chrome.storage.local.set({
    [SETTING_KEYS.tabOrder]: items.map((li) => li.dataset.id),
    [SETTING_KEYS.tabsHidden]: items.filter((li) => !li.querySelector("input").checked).map((li) => li.dataset.id),
  });
  buildStartTabSelect(await getSettings());
}

// "Open on": last used tab, or one of the tabs that are currently shown.
function buildStartTabSelect(settings) {
  const select = els.settingStartTab;
  select.replaceChildren(new Option("Last used tab", "last"));
  for (const id of settings.visibleTabs) select.add(new Option(TABS.find((t) => t.id === id).label, id));
  select.value = settings.startTab === "last" || settings.visibleTabs.includes(settings.startTab) ? settings.startTab : "last";
}

// --- File names: draggable blocks ---

let nameSettings = null; // { blocks, separator, custom, bpmStyle, keyStyle } as currently edited

function renderNameBlocks() {
  const used = nameSettings.blocks;
  els.nameUsed.replaceChildren();
  els.nameAvailable.replaceChildren();

  for (const id of used) {
    const block = NAME_BLOCKS.find((b) => b.id === id);
    const chip = document.createElement("div");
    chip.className = "block-chip";
    chip.dataset.id = id;
    chip.innerHTML = '<span class="grip" aria-hidden="true">⋮⋮</span><span class="chip-label"></span><button class="chip-x" aria-label="Remove">×</button>';
    chip.querySelector(".chip-label").textContent = block.label;
    chip.querySelector(".chip-x").addEventListener("click", () => setNameBlocks(used.filter((x) => x !== id)));
    nameSortable.attach(chip);
    els.nameUsed.appendChild(chip);
  }
  for (const block of NAME_BLOCKS.filter((b) => !used.includes(b.id))) {
    const chip = document.createElement("div");
    chip.className = "block-chip available";
    chip.dataset.id = block.id;
    chip.innerHTML = '<span class="chip-label"></span>';
    chip.querySelector(".chip-label").textContent = `+ ${block.label}`;
    chip.addEventListener("click", () => setNameBlocks([...used, block.id]));
    nameSortable.attach(chip);
    els.nameAvailable.appendChild(chip);
  }

  els.nameCustomRow.classList.toggle("hidden", !used.includes("custom"));
  els.namePreview.textContent = buildName(
    { nameBlocks: used, nameSeparator: nameSettings.separator, nameCustom: nameSettings.custom, bpmStyle: nameSettings.bpmStyle, keyStyle: nameSettings.keyStyle },
    { title: "Midnight Drive", producer: "Beatmaker", bpm: 140, key: "A minor", format: "mp3" }
  ) + ".mp3";
}

async function setNameBlocks(blocks) {
  nameSettings.blocks = validNameBlocks(blocks); // never empty
  await chrome.storage.local.set({ [SETTING_KEYS.nameBlocks]: nameSettings.blocks });
  renderNameBlocks();
}

// After a drop, the "used" row's DOM order is the new order (dropping onto "Available" removes).
const nameSortable = makeSortable([els.nameUsed, els.nameAvailable], () => {
  if (!nameSettings) return;
  const fromDom = [...els.nameUsed.children].map((chip) => chip.dataset.id);
  if (fromDom.join() !== nameSettings.blocks.join()) setNameBlocks(fromDom);
  else renderNameBlocks(); // restore chips that were dragged but dropped back in place
});

function initNameBuilder(settings) {
  nameSettings = {
    blocks: settings.nameBlocks,
    separator: settings.nameSeparator,
    custom: settings.nameCustom,
    bpmStyle: settings.bpmStyle,
    keyStyle: settings.keyStyle,
  };
  for (const sep of NAME_SEPARATORS) els.settingNameSeparator.add(new Option(sep.label, sep.value));
  for (const style of BPM_STYLES) els.settingBpmStyle.add(new Option(style.label, style.value));
  for (const style of KEY_STYLES) els.settingKeyStyle.add(new Option(style.label, style.value));
  els.settingNameSeparator.value = nameSettings.separator;
  els.settingBpmStyle.value = nameSettings.bpmStyle;
  els.settingKeyStyle.value = nameSettings.keyStyle;
  for (const [el, prop, key] of [
    [els.settingBpmStyle, "bpmStyle", SETTING_KEYS.bpmStyle],
    [els.settingKeyStyle, "keyStyle", SETTING_KEYS.keyStyle],
  ]) {
    el.addEventListener("change", () => {
      nameSettings[prop] = el.value;
      chrome.storage.local.set({ [key]: el.value });
      renderNameBlocks();
    });
  }
  els.settingNameCustom.value = nameSettings.custom;
  els.settingNameSeparator.addEventListener("change", () => {
    nameSettings.separator = els.settingNameSeparator.value;
    chrome.storage.local.set({ [SETTING_KEYS.nameSeparator]: nameSettings.separator });
    renderNameBlocks();
  });
  els.settingNameCustom.addEventListener("input", () => {
    nameSettings.custom = els.settingNameCustom.value.trim();
    chrome.storage.local.set({ [SETTING_KEYS.nameCustom]: nameSettings.custom });
    renderNameBlocks();
  });
  renderNameBlocks();
}

async function initSettingsTab() {
  const settings = await getSettings();

  els.settingNormalizeLink.checked = settings.normalize.link;
  els.settingNormalizeSample.checked = settings.normalize.sample;
  els.settingNormalizeFile.checked = settings.normalize.file;
  els.settingTargetLufs.value = String(settings.targetLufs);
  els.settingSaveAs.checked = settings.saveAs;
  els.settingSubfolder.value = settings.subfolder;
  els.settingPrefetch.checked = settings.prefetch;
  els.settingQueueConcurrency.value = String(settings.queueConcurrency);
  els.settingTags.checked = settings.tags;
  els.settingAnalyzeLink.checked = settings.analyze.link;
  els.settingAnalyzeSample.checked = settings.analyze.sample;
  els.settingAnalyzeFile.checked = settings.analyze.file;
  els.settingDeleteOriginal.checked = settings.deleteOriginal;
  els.settingCloseTunebat.checked = settings.closeTunebatTab;
  els.settingAutoUpdate.checked = settings.autoUpdateCheck;
  buildFormatChips(settings.formats);
  buildTabsList(settings);
  buildStartTabSelect(settings);
  initNameBuilder(settings);

  const checkbox = (el) => () => el.checked;
  const bindings = [
    [els.settingNormalizeLink, SETTING_KEYS.normalizeLink, "change", checkbox(els.settingNormalizeLink)],
    [els.settingNormalizeSample, SETTING_KEYS.normalizeSample, "change", checkbox(els.settingNormalizeSample)],
    [els.settingNormalizeFile, SETTING_KEYS.normalizeFile, "change", checkbox(els.settingNormalizeFile)],
    [els.settingTargetLufs, SETTING_KEYS.targetLufs, "change", () => Number(els.settingTargetLufs.value)],
    [els.settingSaveAs, SETTING_KEYS.saveAs, "change", checkbox(els.settingSaveAs)],
    [els.settingSubfolder, SETTING_KEYS.subfolder, "input", () => els.settingSubfolder.value.trim()],
    [els.settingStartTab, SETTING_KEYS.startTab, "change", () => els.settingStartTab.value],
    [els.settingPrefetch, SETTING_KEYS.prefetch, "change", checkbox(els.settingPrefetch)],
    [els.settingQueueConcurrency, SETTING_KEYS.queueConcurrency, "change", () => Number(els.settingQueueConcurrency.value)],
    [els.settingTags, SETTING_KEYS.tags, "change", checkbox(els.settingTags)],
    [els.settingAnalyzeLink, SETTING_KEYS.analyzeLink, "change", checkbox(els.settingAnalyzeLink)],
    [els.settingAnalyzeSample, SETTING_KEYS.analyzeSample, "change", checkbox(els.settingAnalyzeSample)],
    [els.settingAnalyzeFile, SETTING_KEYS.analyzeFile, "change", checkbox(els.settingAnalyzeFile)],
    [els.settingDeleteOriginal, SETTING_KEYS.deleteOriginal, "change", checkbox(els.settingDeleteOriginal)],
    [els.settingCloseTunebat, SETTING_KEYS.closeTunebatTab, "change", checkbox(els.settingCloseTunebat)],
    [els.settingAutoUpdate, SETTING_KEYS.autoUpdateCheck, "change", checkbox(els.settingAutoUpdate)],
  ];
  for (const [el, key, eventName, read] of bindings) {
    el.addEventListener(eventName, () => chrome.storage.local.set({ [key]: read() }));
  }

  showRecordingShortcut();
  els.btnShortcuts.addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
  els.appVersion.textContent = chrome.runtime.getManifest?.().version || els.appVersion.textContent;
  els.settingsBtnRecheck.addEventListener("click", () => {
    checkServer();
    refreshUpdates({ force: true });
  });
  els.btnCheckUpdates.addEventListener("click", () => refreshUpdates({ force: true }));
  els.btnYtdlpUpdate.addEventListener("click", updateYtdlp);
  els.btnAppUpdate.addEventListener("click", updateApp);
  initTips();
  els.settingsBtnClearCache.addEventListener("click", handleClearCache);
  els.settingsBtnReset.addEventListener("click", handleResetSettings);
}

// Two clicks (the second within 4 s) wipe every saved setting — history, queue and files stay.
let resetArmedTimer = null;
async function handleResetSettings() {
  const button = els.settingsBtnReset;
  if (!resetArmedTimer) {
    button.textContent = "Click again to confirm";
    resetArmedTimer = setTimeout(() => {
      resetArmedTimer = null;
      button.textContent = "Reset settings to defaults";
    }, 4000);
    return;
  }
  clearTimeout(resetArmedTimer);
  resetArmedTimer = null;
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("settings.")));
  location.reload(); // rebuild every control from the defaults
}

// Forgets what the popup remembers about pages and its last tab. Settings, History, the
// download queue and pending analyses are not touched — clearing those would lose real work.
async function handleClearCache() {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter(
    (k) => k === "activeTab" || k.startsWith("bundle:") || k.startsWith("pendingDownload:") || k.startsWith("analysis:") || k.startsWith(FILE_ANALYSIS_PREFIX)
  );
  if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);

  const original = els.settingsBtnClearCache.textContent;
  els.settingsBtnClearCache.textContent = "Cleared!";
  setTimeout(() => {
    els.settingsBtnClearCache.textContent = original;
  }, 1500);
}
