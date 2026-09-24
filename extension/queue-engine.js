// Download queue, run by the background service worker (importScripts'd by background.js) so it
// keeps going with the popup closed. State lives in chrome.storage.local["queue"]; the popup
// only renders it (storage.onChanged) and sends commands (queue:add / remove / retry / clear).
//
// Items run one at a time: yt-dlp's extraction is the heavy part, and this keeps the CPU and
// the network calm. If the worker is killed mid-download, the next start puts the interrupted
// item back in line (resumeQueue) and carries on.

const QUEUE_KEY = "queue";
const QUEUE_MAX = 300;

let queueRunning = false;
let queueLock = Promise.resolve();

async function loadQueue() {
  const items = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(items[QUEUE_KEY]) ? items[QUEUE_KEY] : [];
}

// Every change goes through here, one at a time: the engine and the popup's commands would
// otherwise overwrite each other's read-modify-write.
function mutateQueue(change) {
  const run = queueLock.then(async () => {
    const queue = await loadQueue();
    const result = change(queue);
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    return result;
  });
  queueLock = run.catch(() => {});
  return run;
}

function patchQueueItem(id, patch) {
  return mutateQueue((queue) => {
    const item = queue.find((i) => i.id === id);
    if (item) Object.assign(item, patch);
  });
}

async function queueAdd(items, format) {
  const added = await mutateQueue((queue) => {
    let count = 0;
    for (const entry of items) {
      // Already waiting / running with the same format: don't add it twice.
      if (queue.some((i) => i.url === entry.url && i.format === format && (i.status === "queued" || i.status === "working"))) continue;
      if (queue.length >= QUEUE_MAX) break;
      queue.push({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        url: entry.url,
        title: entry.title || "",
        uploader: entry.uploader || "",
        format,
        status: "queued",
        step: "",
        error: "",
      });
      count++;
    }
    return count;
  });
  runQueue();
  return added;
}

function queueRemove(id) {
  return mutateQueue((queue) => {
    const index = queue.findIndex((i) => i.id === id);
    if (index !== -1 && queue[index].status !== "working") queue.splice(index, 1);
  });
}

function queueRetry(id) {
  const result = mutateQueue((queue) => {
    for (const item of queue) {
      if ((id ? item.id === id : true) && item.status === "error") Object.assign(item, { status: "queued", error: "", step: "" });
    }
  });
  return result.then(() => runQueue());
}

// scope "done" = finished ones; "all" = everything that isn't running right now.
function queueClear(scope) {
  return mutateQueue((queue) => {
    const keep = queue.filter((i) => i.status === "working" || (scope === "done" && i.status !== "done"));
    queue.splice(0, queue.length, ...keep);
  });
}

// Worker (re)started: an item still marked "working" belongs to a run that died with it.
async function resumeQueue() {
  await mutateQueue((queue) => {
    for (const item of queue) if (item.status === "working") Object.assign(item, { status: "queued", step: "" });
  });
  runQueue();
}

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  // Any extension API call resets the worker's idle timer, so a long batch isn't cut off.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  let processed = 0;
  let failed = 0;
  try {
    for (;;) {
      await updateQueueBadge();
      const item = await mutateQueue((queue) => {
        const next = queue.find((i) => i.status === "queued");
        if (!next) return null;
        Object.assign(next, { status: "working", step: "Starting…", error: "" });
        return { ...next };
      });
      if (!item) break;
      const ok = await processQueueItem(item);
      processed++;
      if (!ok) failed++;
    }
  } finally {
    clearInterval(keepAlive);
    queueRunning = false;
  }
  await updateQueueBadge(processed, failed);
}

async function processQueueItem(item) {
  const step = (text) => patchQueueItem(item.id, { step: text });
  try {
    const settings = await getSettings();
    let url = item.url;
    let title = item.title;
    let uploader = item.uploader;

    if (/open\.spotify\.com/i.test(url)) {
      await step("Finding it on YouTube…");
      const res = await fetch(`${SERVER}/api/spotify-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, prefetch: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unknown error.");
      url = data.youtube.url;
      title = data.youtube.title;
      uploader = data.youtube.uploader;
    }

    await step("Downloading & converting…");
    const res = await fetch(`${SERVER}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, format: item.format, ...(await getNormalizeOptions("link")) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    title = data.title || title;
    uploader = data.uploader ?? uploader;
    const filename = `${buildFileName(settings.fileNameTemplate, { title, uploader })}.${item.format}`;

    await step("Saving…");
    // No "save as" dialog here, whatever the setting says: a dialog per item would defeat a queue.
    const downloadId = await startDownload(
      `${SERVER}${data.downloadUrl}`,
      filename,
      { source: "link", title: title || filename, format: item.format, mediaUrl: url },
      { forceNoDialog: true }
    );
    await patchQueueItem(item.id, { status: "done", title: title || item.title, step: "", downloadId });
    return true;
  } catch (err) {
    const message = err instanceof TypeError ? "Can't reach the local server. Is it running?" : withYtdlpHint(err.message);
    await patchQueueItem(item.id, { status: "error", error: message, step: "" });
    return false;
  }
}

// Toolbar badge: how many are left while running, ✓ (or !) when a batch just finished.
// A recording in progress owns the badge, so it's left alone then.
async function updateQueueBadge(processed = 0, failed = 0) {
  try {
    if ((await sampleStatus()).recording) return;
    const queue = await loadQueue();
    const left = queue.filter((i) => i.status === "queued" || i.status === "working").length;
    if (left > 0) setBadge(String(left), "#6c5ce7");
    else if (processed > 0) setBadge(failed ? "!" : "✓", failed ? "#f87171" : "#34d399");
    else setBadge("");
  } catch {
    // the badge is cosmetic
  }
}
