// Popup bootstrap: server status, tabs (order/visibility from Settings) and startup.

// Checks the local server and shows the result in Settings > Local server (dot + text),
// plus a red dot on the Settings gear while it's unreachable so it's visible from any tab.
async function checkServer() {
  els.serverDot.className = "dot";
  els.settingsServerText.textContent = "Checking…";
  try {
    const res = await fetch(`${SERVER}/health`);
    if (!res.ok) throw new Error();
    els.serverDot.classList.add("ok");
    els.settingsServerText.textContent = "Connected";
    setServerAlert(false);
    return true;
  } catch {
    els.serverDot.classList.add("err");
    els.settingsServerText.textContent = "Not connected";
    setServerAlert(true);
    return false;
  }
}

function setServerAlert(down) {
  els.tabSettings.classList.toggle("alert", down);
  const label = down ? "Settings — server not connected" : "Settings";
  els.tabSettings.title = label;
  els.tabSettings.setAttribute("aria-label", label);
}

// The page open in the current tab (what the Link tab loads by default).
let activeTabInfo = { url: "", title: "", ready: false };
let linkLoaded = false;

async function main() {
  getSettings().then((settings) => applyVisibleFormats(settings.formats));
  initFileTab();
  initHistoryTab();
  initSampleTab();
  initSettingsTab();

  // Tab restore (storage read) and the active-tab lookup don't depend on each other.
  const [, [tab]] = await Promise.all([
    setupTabs(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  activeTabInfo = { url: tab?.url || "", title: tab?.title || "", ready: true };
  initPasteRow();
  ensureLinkLoaded();
  // The Link flow checks the server itself; with that tab hidden, still show the status.
  if (!linkLoaded) checkServer();
}

// The Link tab's work (analysis + background prefetch on the server) starts only if the tab
// is actually in use — a hidden or never-opened Link tab costs nothing.
function ensureLinkLoaded() {
  if (linkLoaded || !activeTabInfo.ready || els.panelLink.classList.contains("hidden")) return;
  linkLoaded = true;
  loadLink(activeTabInfo.url, { tabTitle: activeTabInfo.title });
}

// --- Tabs ---

const TAB_ELEMENTS = {
  file: [els.tabFile, els.panelFile],
  link: [els.tabLink, els.panelLink],
  sample: [els.tabSample, els.panelSample],
  history: [els.tabHistory, els.panelHistory],
  settings: [els.tabSettings, els.panelSettings],
};
let visibleTabs = TABS.map((t) => t.id);

// Order (left group) and visibility come from Settings (Settings itself is always available).
function applyTabSettings(settings) {
  visibleTabs = settings.visibleTabs;
  for (const id of settings.tabOrder) {
    const button = TAB_ELEMENTS[id][0];
    if (TABS.find((t) => t.id === id).side === "left") els.tabsBar.appendChild(button); // re-appending moves it: this is the reordering
    button.classList.toggle("hidden", !visibleTabs.includes(id));
  }
}

async function setupTabs() {
  for (const [id, [button]] of Object.entries(TAB_ELEMENTS)) button.addEventListener("click", () => switchTab(id));

  const settings = await getSettings();
  applyTabSettings(settings);
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !(SETTING_KEYS.tabOrder in changes || SETTING_KEYS.tabsHidden in changes)) return;
    applyTabSettings(await getSettings());
  });

  // Remember whichever tab was open last, so reopening the popup lands back on it.
  const stored = await chrome.storage.local.get("activeTab");
  const wanted = settings.startTab === "last" ? stored.activeTab : settings.startTab;
  const fallback = visibleTabs.includes("link") ? "link" : visibleTabs[0];
  switchTab(wanted === "settings" || visibleTabs.includes(wanted) ? wanted : fallback);
}

function switchTab(which) {
  if (which !== "settings" && !visibleTabs.includes(which)) which = visibleTabs[0];
  for (const [id, [button, panel]] of Object.entries(TAB_ELEMENTS)) {
    const isActive = id === which;
    button.classList.toggle("active", isActive);
    panel.classList.toggle("hidden", !isActive);
  }
  chrome.storage.local.set({ activeTab: which });
  if (which === "settings") refreshYtdlpStatus();
  if (which === "history") renderHistory();
  if (which === "link") ensureLinkLoaded();
}

main();
