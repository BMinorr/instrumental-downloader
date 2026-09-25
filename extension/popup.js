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
  setupDetach();
  getSettings().then((settings) => applyVisibleFormats(settings.formats));
  initFileTab();
  initHistoryTab();
  initSampleTab();
  initSettingsTab();

  // Tab restore (storage read) and the active-tab lookup don't depend on each other.
  const [, [tab]] = await Promise.all([
    setupTabs(),
    // Detached window: its own "current tab" is this page, so Link only uses pasted links.
    IS_DETACHED ? [] : chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  activeTabInfo = { url: tab?.url || "", title: tab?.title || "", ready: true };
  initPasteRow();
  ensureLinkLoaded();
  // The Link flow checks the server itself; with that tab hidden, still show the status.
  if (!linkLoaded) checkServer();
  startupUpdateCheck();
}

// The Link tab's work (analysis + background prefetch on the server) starts only if the tab
// is actually in use — a hidden or never-opened Link tab costs nothing.
function ensureLinkLoaded() {
  if (linkLoaded || !activeTabInfo.ready || els.panelLink.classList.contains("hidden")) return;
  linkLoaded = true;
  loadLink(activeTabInfo.url, { tabTitle: activeTabInfo.title });
}

// --- Detached window ---

const DETACHED_WINDOW_KEY = "detachedWindowId"; // chrome.storage.session: ids are only valid within a browser session
const ACTIVE_TAB_KEY = IS_DETACHED ? "activeTabDetached" : "activeTab"; // the two views remember their own tab
const DETACHED_WIDTH = 336; // inner width: the 320px layout + room for a scrollbar

// The button opens (or focuses) the small window and closes this popup. Inside the window the
// button is hidden and the window is sized so the UI fits (frame sizes differ per OS).
function setupDetach() {
  if (IS_DETACHED) {
    els.btnDetach.classList.add("hidden");
    document.body.classList.add("detached");
    fitDetachedWindow();
    return;
  }
  els.btnDetach.addEventListener("click", openDetached);
}

async function openDetached() {
  const stored = await chrome.storage.session.get(DETACHED_WINDOW_KEY);
  const existing = stored[DETACHED_WINDOW_KEY];
  if (existing != null) {
    try {
      const win = await chrome.windows.get(existing);
      if (win.type === "popup") {
        await chrome.windows.update(existing, { focused: true });
        window.close();
        return;
      }
    } catch {
      // closed since: open a new one
    }
  }
  const here = await chrome.windows.getCurrent();
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?detached=1"),
    type: "popup",
    width: DETACHED_WIDTH + 16,
    height: 700,
    left: Math.max(0, (here.left ?? 0) + (here.width ?? 0) - DETACHED_WIDTH - 60),
    top: (here.top ?? 0) + 60,
  });
  await chrome.storage.session.set({ [DETACHED_WINDOW_KEY]: win.id });
  window.close();
}

// outer size = inner size + the window frame, which we can only measure from inside.
async function fitDetachedWindow() {
  try {
    const win = await chrome.windows.getCurrent();
    const frame = (outer, inner) => Math.min(120, Math.max(0, outer - inner)); // sanity-clamped
    const frameW = frame(window.outerWidth, window.innerWidth);
    const frameH = frame(window.outerHeight, window.innerHeight);
    const innerH = Math.min(screen.availHeight - frameH - 60, 680);
    await chrome.windows.update(win.id, { width: DETACHED_WIDTH + frameW, height: innerH + frameH });
  } catch {
    // keep the size it opened with
  }
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
  visibleTabs = IS_DETACHED ? settings.visibleTabs.filter((id) => id !== "sample") : settings.visibleTabs;
  if (!visibleTabs.length) visibleTabs = [settings.tabOrder.find((id) => id !== "sample")];
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
  const stored = await chrome.storage.local.get(ACTIVE_TAB_KEY);
  const wanted = settings.startTab === "last" ? stored[ACTIVE_TAB_KEY] : settings.startTab;
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
  chrome.storage.local.set({ [ACTIVE_TAB_KEY]: which });
  if (which === "settings") onSettingsOpened();
  if (which === "history") renderHistory();
  if (which === "link") ensureLinkLoaded();
}

main();
