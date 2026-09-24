// Automatic BPM/key analysis, run by the background worker after every download:
//   1. the downloaded file is fed to Tunebat in a background tab (the user's tab is left alone),
//   2. BPM and key are read back from the page,
//   3. the file is saved again under its final name (name blocks incl. BPM + key, tags for
//      MP3/FLAC) and the first copy is deleted,
//   4. History (and the queue item, if any) get the result — that's what the popup shows.
// Jobs run one at a time and share a single Tunebat tab, so a batch pays the page load once;
// the tab is closed a few seconds after the last job (Settings can keep it open).
//
// The first download keeps the file usable even if any step fails: nothing is deleted
// unless the renamed copy has finished saving.
//
// A "standalone" job (File tab: a file was just added, nothing downloaded yet) only does
// steps 1–2 and stores the result under `analysisFile:<fileUrl>`; when the file is converted
// later, its name already has BPM and key and no second analysis is needed.

const TUNEBAT_OK = ["mp3", "wav", "flac", "aac", "ogg", "m4a"]; // what Tunebat's uploader accepts
const TUNEBAT_TAB_KEY = "tunebatTabId";
const COMPACT_ABOVE_BYTES = 30 * 1024 * 1024; // bigger files are analyzed from a small mono copy

let analysisRunning = false;
let analysisLock = Promise.resolve();
let tunebatTabId = null;
let closeTabTimer = null;

async function loadAnalysisJobs() {
  const items = await chrome.storage.local.get(ANALYSIS_JOBS_KEY);
  return Array.isArray(items[ANALYSIS_JOBS_KEY]) ? items[ANALYSIS_JOBS_KEY] : [];
}

function mutateAnalysisJobs(change) {
  const run = analysisLock.then(async () => {
    const jobs = await loadAnalysisJobs();
    const result = change(jobs);
    await chrome.storage.local.set({ [ANALYSIS_JOBS_KEY]: jobs });
    return result;
  });
  analysisLock = run.catch(() => {});
  return run;
}

async function enqueueAnalysis(job) {
  await mutateAnalysisJobs((jobs) => {
    if (!jobs.some((j) => j.id === job.id)) jobs.push({ ...job, status: "queued" });
  });
  runAnalysis();
}

// "Analyze again" from History: rebuild the job from the entry (its server copy must still exist).
async function retryAnalysis(historyId) {
  const entry = (await loadHistory()).find((e) => e.id === historyId);
  if (!entry) return false;
  await updateHistory(historyId, { analysis: "pending" });
  await enqueueAnalysis({
    id: `${entry.id}-${Date.now().toString(36)}`, // a fresh job id, same history entry
    historyId: entry.id,
    fileUrl: entry.fileUrl,
    downloadId: entry.downloadId,
    filename: entry.filename,
    title: entry.title,
    producer: entry.producer,
    format: entry.format,
    source: entry.source,
    mediaUrl: entry.mediaUrl,
  });
  return true;
}

// Worker (re)started: a job that was running died with the previous worker — run it again.
async function resumeAnalysis() {
  await mutateAnalysisJobs((jobs) => {
    for (const job of jobs) if (job.status === "working") job.status = "queued";
  });
  runAnalysis();
}

async function runAnalysis() {
  if (analysisRunning) return;
  analysisRunning = true;
  clearTimeout(closeTabTimer);
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    for (;;) {
      const job = await mutateAnalysisJobs((jobs) => {
        const next = jobs.find((j) => j.status === "queued");
        if (next) next.status = "working";
        return next ? { ...next } : null;
      });
      if (!job) break;
      try {
        await processAnalysis(job);
      } finally {
        await mutateAnalysisJobs((jobs) => {
          const index = jobs.findIndex((j) => j.id === job.id);
          if (index !== -1) jobs.splice(index, 1);
        });
      }
    }
  } finally {
    clearInterval(keepAlive);
    analysisRunning = false;
    scheduleTunebatTabClose();
  }
}

// Result of a job goes to History and, for queue downloads, to the queue item; a standalone
// (File tab) job has neither — its state lives in its own storage key for the popup to read.
async function setAnalysisState(job, patch) {
  if (job.standalone) {
    const key = FILE_ANALYSIS_PREFIX + job.fileUrl;
    const current = (await chrome.storage.local.get(key))[key] || {};
    await chrome.storage.local.set({ [key]: { ...current, ...patch, ts: Date.now() } });
    return;
  }
  await updateHistory(job.historyId, patch);
  if (job.queueId) await patchQueueItem(job.queueId, patch);
}

// Standalone results older than a day are of no use (the server copy is long gone).
async function pruneFileAnalyses() {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith(FILE_ANALYSIS_PREFIX) && Date.now() - (all[k]?.ts || 0) > 24 * 3600 * 1000);
  if (stale.length) await chrome.storage.local.remove(stale);
}

async function processAnalysis(job) {
  try {
    await setAnalysisState(job, { analysis: "analyzing" });
    const settings = await getSettings();
    const result = await analyzeOnTunebat(job);
    if (!result) {
      await setAnalysisState(job, { analysis: "failed", analysisError: "Tunebat didn't return a result." });
      return;
    }
    if (job.standalone) {
      await setAnalysisState(job, { analysis: "done", analysisError: "", bpm: result.bpm, key: result.key });
      pruneFileAnalyses().catch(() => {});
      return;
    }
    await finalizeAnalysis(job, result, settings);
  } catch (err) {
    await setAnalysisState(job, { analysis: "failed", analysisError: err.message }).catch(() => {});
  }
}

// --- Talking to Tunebat ---

async function analyzeOnTunebat(job) {
  // Tunebat's uploader doesn't take AIFF/OPUS, and a huge lossless file is slow to hand over
  // (it's base64-encoded into the page): for those, analyze a small mono 22 kHz WAV copy
  // made on the spot — plenty for BPM and key, and never saved anywhere.
  let sourceUrl = job.fileUrl;
  let ext = job.format;
  const size = Number((await fetch(sourceUrl, { method: "HEAD" }).catch(() => null))?.headers.get("content-length")) || 0;
  if (!TUNEBAT_OK.includes(ext) || size > COMPACT_ABOVE_BYTES) {
    const res = await fetch(`${SERVER}/api/analysis-source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: decodeURIComponent(job.fileUrl.split("/").pop()) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not prepare the file for Tunebat.");
    sourceUrl = `${SERVER}${data.downloadUrl}`;
    ext = "wav";
  }

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error("The file is no longer on the server.");
  const base64 = arrayBufferToBase64(await res.arrayBuffer());
  // A unique name per job, so the row can be found again however many files are in the table.
  const uniqueName = `${newId()}.${ext}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const tabId = await ensureTunebatTab();
    try {
      if (!(await waitForTunebatUpload(tabId, 20000))) throw new Error("Tunebat's page didn't load.");
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN", // the page's own File/DataTransfer — an isolated-world File is ignored by its React code
        func: injectFileIntoPage,
        args: [base64, uniqueName, AUDIO_MIME_TYPES],
      });
      if (!injection?.result?.ok) throw new Error(injection?.result?.reason || "Couldn't insert the file into Tunebat.");
      return await pollTunebatResult(tabId, uniqueName, 90000);
    } catch (err) {
      if (attempt === 1) throw err;
      await discardTunebatTab(); // stale/closed/broken tab: start over with a fresh one
    }
  }
  return null;
}

async function pollTunebatResult(tabId, name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readTunebatResult,
      args: [name],
    });
    if (injection?.result) return injection.result;
  }
  return null;
}

// One background tab (never activated) is reused for every job of a batch.
async function ensureTunebatTab() {
  clearTimeout(closeTabTimer);
  if (tunebatTabId === null) {
    tunebatTabId = (await chrome.storage.local.get(TUNEBAT_TAB_KEY))[TUNEBAT_TAB_KEY] ?? null;
  }
  if (tunebatTabId !== null) {
    try {
      const tab = await chrome.tabs.get(tunebatTabId);
      if (/tunebat\.com/i.test(tab.url || tab.pendingUrl || "")) return tunebatTabId;
    } catch {
      // closed since
    }
  }
  const tab = await chrome.tabs.create({ url: TUNEBAT_URL, active: false });
  tunebatTabId = tab.id;
  await chrome.storage.local.set({ [TUNEBAT_TAB_KEY]: tab.id });
  return tab.id;
}

async function discardTunebatTab() {
  const id = tunebatTabId;
  tunebatTabId = null;
  await chrome.storage.local.remove(TUNEBAT_TAB_KEY);
  if (id !== null) await chrome.tabs.remove(id).catch(() => {});
}

// Closes the shared tab a few seconds after the last job — but not while downloads are still
// running: more files are about to arrive, and reopening the page for each would waste the
// point of sharing it.
function scheduleTunebatTabClose() {
  clearTimeout(closeTabTimer);
  closeTabTimer = setTimeout(async () => {
    if (analysisRunning) return;
    const queue = await loadQueue();
    if (queue.some((i) => i.status === "queued" || i.status === "working")) {
      scheduleTunebatTabClose();
      return;
    }
    if ((await getSettings()).closeTunebatTab) await discardTunebatTab();
  }, 4000);
}

// --- Saving under the final name ---

async function waitDownloadComplete(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id });
    if (!item) return false;
    if (item.state === "complete") return true;
    if (item.state === "interrupted") return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function finalizeAnalysis(job, result, settings) {
  const done = { analysis: "done", analysisError: "", bpm: result.bpm, key: result.key };
  const ext = job.format;
  const finalBase = buildName(settings, {
    title: job.title,
    producer: job.producer,
    format: ext,
    bpm: result.bpm,
    key: result.key,
  });
  const folder = cleanSubfolder(settings.subfolder);
  const finalName = `${folder ? folder + "/" : ""}${finalBase}.${ext}`;

  // Nothing to rename (the blocks don't include BPM/key), or the user picked where to save
  // each file by hand — a silent second save elsewhere would surprise them. Just record it.
  if (finalName === job.filename || settings.saveAs) {
    await setAnalysisState(job, done);
    return;
  }

  // Saved second copy first, original deleted only after that copy is safely on disk.
  await waitDownloadComplete(job.downloadId, 120000);
  let url = job.fileUrl;
  if (ext === "mp3" || ext === "flac") {
    // Same audio, BPM + key written into the tags (a stream copy: instant and lossless).
    const res = await fetch(`${SERVER}/api/annotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: decodeURIComponent(job.fileUrl.split("/").pop()),
        bpm: result.bpm,
        key: shortKey(result.key) || result.key,
      }),
    });
    const data = await res.json();
    if (res.ok) url = `${SERVER}${data.downloadUrl}`; // if tagging fails, the plain copy still gets the name
  }

  const newDownloadId = await startDownload(url, `${finalBase}.${ext}`, null, { forceNoDialog: true });
  if (newDownloadId === null || !(await waitDownloadComplete(newDownloadId, 180000))) {
    await setAnalysisState(job, done); // renamed copy didn't finish: keep the original as it is
    return;
  }

  if (settings.deleteOriginal) {
    try {
      await chrome.downloads.removeFile(job.downloadId);
      await chrome.downloads.erase({ id: job.downloadId });
    } catch {
      // already moved or deleted by the user
    }
  }
  await setAnalysisState(job, { ...done, filename: finalName, fileUrl: url, downloadId: newDownloadId });
}
