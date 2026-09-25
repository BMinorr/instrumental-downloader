importScripts("shared.js", "tunebat.js", "queue-engine.js", "analysis-engine.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return; // not for us

  if (message.type === "analysis:enqueue") {
    enqueueAnalysis(message.job)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "analysis:retry") {
    retryAnalysis(message.historyId)
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "queue:add") {
    queueAdd(message.items || [], message.format)
      .then((added) => sendResponse({ ok: true, added }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "queue:remove" || message.type === "queue:retry" || message.type === "queue:clear") {
    const action =
      message.type === "queue:remove" ? queueRemove(message.id)
      : message.type === "queue:retry" ? queueRetry(message.id)
      : queueClear(message.scope);
    action.then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "sample:start") {
    startSampleRecording()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "sample:stop") {
    stopSampleRecording()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "sample:discard") {
    discardSampleRecording()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "sample:status") {
    sampleStatus()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "sample:getLast") {
    getLastSampleRecording()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// --- Sample tab: tab-audio recording, coordinated through an offscreen document ---
// (the service worker has no DOM/AudioContext, so the offscreen doc does the real
// capture/recording work and keeps running even if the worker or popup goes away).

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record audio playing in the active tab (Sample tab).",
  });
}

// --- Toolbar badge: shows recording state even with the popup closed ---

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// "Open in pop-out window": with the setting on, the toolbar button has no dropdown and opens the
// detached window instead (setPopup is per browser session, so this runs on every worker start).
async function applyActionMode() {
  const { openDetached } = await getSettings();
  await chrome.action.setPopup({ popup: openDetached ? "" : "popup.html" });
}
chrome.action.onClicked.addListener(() => openDetachedWindow().catch(() => {}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && SETTING_KEYS.openDetached in changes) applyActionMode().catch(() => {});
});
applyActionMode().catch(() => {});

chrome.runtime.onInstalled.addListener(() => setBadge(""));
chrome.runtime.onStartup.addListener(() => {
  resumeQueue();
  resumeAnalysis();
});
// The worker may just have been restarted mid-batch: pick up where the last one stopped.
resumeQueue();
resumeAnalysis();

// Keyboard shortcut (default Alt+Shift+R, changeable at chrome://extensions/shortcuts):
// start/stop recording the current tab without opening the popup. The shortcut counts
// as invoking the extension on that tab, which is what tabCapture requires.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-recording") return;
  try {
    const status = await sampleStatus();
    if (status.recording) {
      await stopSampleRecording();
      setBadge("✓", "#34d399"); // recording is ready — cleared when the popup is opened
    } else {
      await startSampleRecording(tab);
    }
  } catch (err) {
    setBadge("!", "#f87171");
    setTimeout(() => setBadge(""), 5000);
  }
});

async function startSampleRecording(tabOverride) {
  const tab = tabOverride || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) throw new Error("No active tab found.");

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    streamId,
  });
  if (!response?.ok) throw new Error(response?.error || "Could not start recording.");

  await chrome.storage.local.remove("bundle:__sample__");
  setBadge("REC", "#ef4444");
  return { ok: true };
}

async function stopSampleRecording() {
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
  if (!response?.ok) throw new Error(response?.error || "Could not stop recording.");
  setBadge("");
  // The audio itself stays in the offscreen document's memory (see getLastSampleRecording) —
  // not persisted to chrome.storage, which caps out at 10MB and a several-minute
  // recording can exceed that.
  return { ok: true, durationMs: response.durationMs, audioBase64: response.audioBase64 };
}

async function discardSampleRecording() {
  if (await chrome.offscreen.hasDocument()) {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "discard" });
  }
  await chrome.storage.local.remove("bundle:__sample__");
  setBadge("");
  return { ok: true };
}

async function sampleStatus() {
  if (!(await chrome.offscreen.hasDocument())) {
    return { ok: true, recording: false, elapsedMs: 0, hasLastRecording: false };
  }
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "status" });
  return {
    ok: true,
    recording: !!response?.recording,
    elapsedMs: response?.elapsedMs || 0,
    hasLastRecording: !!response?.hasLastRecording,
  };
}

// Re-fetches the last recording's bytes from the offscreen document's memory (used
// when the popup reopens after the recording finished but wasn't downloaded yet).
async function getLastSampleRecording() {
  if (!(await chrome.offscreen.hasDocument())) {
    return { ok: true, recording: null };
  }
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "getLast" });
  return { ok: true, recording: response?.recording || null };
}







