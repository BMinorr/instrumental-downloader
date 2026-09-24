// Everything that touches Tunebat's page (worker context, importScripts'd): readiness check,
// file injection, result reading. Functions passed to chrome.scripting.executeScript run inside
// the page, so they can't use anything from this file's scope — hence the arguments.

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

// Runs inside the Tunebat tab. Tunebat is a client-side rendered app (its HTML has no
// upload widget at all), so the file input only exists once React has rendered it — and
// React attaches its `__reactProps$…` bookkeeping to the element at that point, meaning
// its change handlers are live. That happens well before the page's full "load" event
// (which waits on ads/analytics), so we don't wait for "load" or use a fixed delay.
// If a future React renames those keys, `readyState === "complete"` is the fallback.
function tunebatUploadReady() {
  if (!location.hostname.endsWith("tunebat.com")) return false;
  const input = document.querySelector('input[type="file"]');
  if (!input) return false;
  return (
    Object.keys(input).some((k) => k.startsWith("__reactProps$")) ||
    document.readyState === "complete"
  );
}

// Polls the freshly opened tab until the upload widget is ready. Errors are expected
// while the tab hasn't navigated yet (nothing scriptable to inject into) — just retry.
// Resolves false on timeout; the caller still tries the injection, which has its own
// short wait for the input.
async function waitForTunebatUpload(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: tunebatUploadReady,
      });
      if (injection?.result) return true;
    } catch {
      // not navigated / not scriptable yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function readTunebatResult(filename) {
  const leaves = [...document.querySelectorAll("body *")].filter(
    (e) => e.children.length === 0 && e.textContent.trim() === filename
  );
  const nameEl = leaves[leaves.length - 1];
  if (!nameEl) return null;

  const KEY = /^[A-G][#♯b♭]?\s+(major|minor)$/i;
  const textsOf = (root) =>
    [...root.querySelectorAll("*")]
      .filter((e) => e.children.length === 0 && e !== nameEl)
      .map((e) => e.textContent.trim())
      .filter(Boolean);

  // Climb from the file name until the enclosing element also holds a key cell (so a file
  // name that itself says "minor" can't be mistaken for one).
  let row = nameEl.parentElement;
  for (let i = 0; i < 6 && row && !textsOf(row).some((t) => KEY.test(t)); i++) row = row.parentElement;
  if (!row) return null;

  const texts = textsOf(row);
  const key = texts.find((t) => KEY.test(t));
  const bpm = texts.find((t) => /^\d{2,3}(\.\d+)?$/.test(t));
  return key && bpm ? { key, bpm: Number(bpm) } : null;
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

    // The widget normally exists by now (see waitForTunebatUpload), but on a slow
    // page keep looking for a few seconds rather than failing outright.
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
