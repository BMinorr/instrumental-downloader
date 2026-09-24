const TUNEBAT_URL = "https://tunebat.com/Analyzer";

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

async function main() {
  els.btnTunebat.addEventListener("click", makeTunebatHandler(els.btnTunebat, els.progress));
  initAnalysisUpdates();
  const linkCard = buildAnalysisCard(
    () => ({ fileUrl: els.btnTunebat.dataset.fileUrl, filename: els.btnTunebat.dataset.filename, downloadId: els.btnTunebat.dataset.downloadId, source: "link", mediaUrl: currentMedia?.url }),
    (text) => { els.progress.classList.remove("hidden"); els.progress.textContent = text; }
  );
  els.btnTunebat.after(linkCard.el);
  analysisCardFor.set(els.btnTunebat, linkCard);
  const sampleCard = buildAnalysisCard(
    () => ({ fileUrl: els.sampleBtnTunebat.dataset.fileUrl, filename: els.sampleBtnTunebat.dataset.filename, downloadId: els.sampleBtnTunebat.dataset.downloadId, source: "sample" }),
    (text) => { els.sampleProgress.classList.remove("hidden"); els.sampleProgress.textContent = text; }
  );
  els.sampleBtnTunebat.after(sampleCard.el);
  analysisCardFor.set(els.sampleBtnTunebat, sampleCard);
  getSettings().then((settings) => applyVisibleFormats(settings.formats));
  initFileTab();
  initHistoryTab();
  initQueueTab();
  initSampleTab();
  initSettingsTab();

  // Tab restore (storage read) and the active-tab lookup don't depend on each other.
  const [, [tab]] = await Promise.all([
    setupTabs(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  activeTabInfo = { url: tab?.url || "", title: tab?.title || "" };
  initPasteRow();
  await loadLink(activeTabInfo.url, { tabTitle: activeTabInfo.title });
}

// The page open in the current tab (what the Link tab loads by default).
const TAB_NAMES = ["file", "link", "sample", "queue", "history", "settings"];

async function setupTabs() {
  els.tabFile.addEventListener("click", () => switchTab("file"));
  els.tabLink.addEventListener("click", () => switchTab("link"));
  els.tabSample.addEventListener("click", () => switchTab("sample"));
  els.tabQueue.addEventListener("click", () => switchTab("queue"));
  els.tabHistory.addEventListener("click", () => switchTab("history"));
  els.tabSettings.addEventListener("click", () => switchTab("settings"));

  // Remember whichever tab was open last, so reopening the popup lands back on it.
  const stored = await chrome.storage.local.get("activeTab");
  const { startTab } = await getSettings();
  const wanted = startTab === "last" ? stored.activeTab : startTab;
  switchTab(TAB_NAMES.includes(wanted) ? wanted : "link");
}

function switchTab(which) {
  const tabs = { file: els.tabFile, link: els.tabLink, sample: els.tabSample, queue: els.tabQueue, history: els.tabHistory, settings: els.tabSettings };
  const panels = { file: els.panelFile, link: els.panelLink, sample: els.panelSample, queue: els.panelQueue, history: els.panelHistory, settings: els.panelSettings };
  for (const name of TAB_NAMES) {
    const isActive = name === which;
    tabs[name].classList.toggle("active", isActive);
    panels[name].classList.toggle("hidden", !isActive);
  }
  chrome.storage.local.set({ activeTab: which });
  if (which === "settings") refreshYtdlpStatus();
  if (which === "history") renderHistory();
}


main();
