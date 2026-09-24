// Runs independently of the popup (which closes/reopens constantly), so download
// completion is tracked reliably even if the user closes the popup mid-download.

// When a tracked download finishes, merge the file info into that media's cached
// bundle so the popup can show the Tunebat button next time it's opened — even if
// it wasn't open when the download actually completed.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state || delta.state.current !== "complete") return;

  const pendingKey = `pendingDownload:${delta.id}`;
  const pendingItems = await chrome.storage.local.get(pendingKey);
  const pending = pendingItems[pendingKey];
  if (!pending) return;

  await chrome.storage.local.remove(pendingKey);

  const bundleKey = `bundle:${pending.cacheKey}`;
  const bundleItems = await chrome.storage.local.get(bundleKey);
  const bundle = bundleItems[bundleKey] || {};
  bundle.downloadedFile = { fileUrl: pending.fileUrl, filename: pending.filename };
  await chrome.storage.local.set({ [bundleKey]: bundle });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return; // not for us

  if (message.type === "openInTunebat") {
    openInTunebat(message.fileUrl, message.filename)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
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

async function startSampleRecording() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
  return { ok: true };
}

async function stopSampleRecording() {
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
  if (!response?.ok) throw new Error(response?.error || "Could not stop recording.");
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

// chrome.scripting.executeScript's `args` must be JSON-serializable (unlike
// structured clone, an ArrayBuffer does NOT survive it — it silently turns into
// "{}"). So we base64-encode the audio bytes here and decode them back inside
// the injected function, which runs in the page's own context.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const TUNEBAT_URL = "https://tunebat.com/Analyzer";

async function openInTunebat(fileUrl, filename) {
  // Fetch first, so a missing/unreachable file is reported to the still-open popup
  // (once the Tunebat tab opens, the popup closes and can't show errors anymore).
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error("Could not read the file.");
  const buffer = await res.arrayBuffer();

  const tab = await chrome.tabs.create({ url: TUNEBAT_URL });

  // Bounded wait: if the tab never reports "complete" (slow network, blocked
  // request, etc.) we'd otherwise hang here forever with the button stuck on
  // "Opening Tunebat...". Fall through and attempt the injection anyway after
  // the timeout — worst case it fails with a clear error instead of a silent hang.
  const pageLoaded = Promise.race([
    new Promise((resolve) => {
      function onUpdated(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    }),
    new Promise((resolve) => setTimeout(resolve, 15000)),
  ]);

  // Encoding a multi-MB file takes a moment — do it while the page loads instead of
  // before/after (the "complete" listener above is already attached).
  const base64 = arrayBufferToBase64(buffer);
  await pageLoaded;

  // Give the page's own scripts a moment to finish mounting the upload widget.
  await new Promise((r) => setTimeout(r, 1000));

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    // MAIN world: constructs File/DataTransfer using the page's OWN realm, not the
    // extension's isolated-world copies. If Tunebat's app does an `instanceof File`
    // check (common in React file-drop handlers), an isolated-world File fails it
    // silently — the event fires but the app just ignores the "file".
    world: "MAIN",
    func: injectFileIntoPage,
    args: [base64, filename, AUDIO_MIME_TYPES],
  });

  if (!result?.ok) {
    throw new Error(result?.reason || "Could not insert the file into Tunebat's page.");
  }
}

const AUDIO_MIME_TYPES = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  ogg: "audio/ogg",
  m4a: "audio/m4a",
};

// Runs inside the Tunebat tab. Tunebat's uploader is a standard (hidden) file
// input that picks up files via a native "change" event — so we build a real
// File from the already-downloaded bytes and feed it in the same way a user's
// own file picker selection would.
// (It's passed its own copy of the MIME table: the function is serialized into the
// page, so it can't see anything from this file's scope.)
async function injectFileIntoPage(base64, filename, mimeTypes) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
    const file = new File([bytes], filename, { type: mimeTypes[ext] || "audio/mpeg" });

    // The widget normally exists by now (see the settle delay in openInTunebat), but
    // on a slow page keep looking for a few seconds rather than failing outright.
    let inputs = document.querySelectorAll('input[type="file"]');
    for (let waited = 0; inputs.length === 0 && waited < 5000; waited += 200) {
      await new Promise((r) => setTimeout(r, 200));
      inputs = document.querySelectorAll('input[type="file"]');
    }
    if (inputs.length === 0) {
      return { ok: false, reason: "No file input found on the page." };
    }

    for (const input of inputs) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Also fire a drop event on any visible drop-zone, in case the app's upload
    // logic is wired there instead of (or in addition to) the input's change event.
    const dropzone = document.querySelector('[class*="drop" i], [class*="upload" i]');
    if (dropzone) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      dropzone.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer })
      );
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
