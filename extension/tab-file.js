// --- File tab: pick/drop a local audio file; it is analyzed on Tunebat right away, then converted ---
// The file is copied to the local server once (POST /api/stash) when it's added and reused for
// the analysis and for every conversion after that. The BPM/key found by the automatic
// analysis (background worker) are shown in a table and go straight into the converted
// file's name — no second analysis.

const FILE_EXTS = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "aiff", "aif", "opus"]; // /api/stash whitelist
const FILE_MAX_BYTES = 100 * 1024 * 1024; // matches the server's /api/stash limit
let selectedFile = null;
// What Tunebat found for the file that's in the drop zone (a two-column BPM | Key table).
const fileResultCard = {
  async refresh() {
    const record = await fileAnalysisRecord();
    renderResultCard(els.fileResultCard, record, record && (() => startFileAnalysis()));
  },
};
let stash = null; // server copy of selectedFile: { name, url } — null until uploaded
let stashPromise = null; // the upload in flight (or done) for selectedFile

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function fileBaseName(name) {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[\\/:*?"<>|]/g, "_");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setFileMessage(message) {
  els.fileProgress.textContent = message;
  els.fileProgress.classList.toggle("hidden", !message);
}

function describeError(err) {
  return err instanceof TypeError
    ? "Can't reach the local server. Is it running?"
    : `Error: ${err.message}`;
}

function initFileTab() {
  fileResultCard.refresh(); // the (empty) tables are on screen from the start
  chrome.storage.onChanged.addListener((changes, area) => {
    const key = fileAnalysisKey();
    if (area === "local" && key && changes[key]) fileResultCard.refresh();
  });
  const openPicker = () => els.fileInput.click();
  els.fileDropzone.addEventListener("click", openPicker);
  els.fileDropzone.addEventListener("keydown", (e) => {
    if (e.target !== els.fileDropzone) return; // ignore keys pressed on the inner clear button
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  els.fileInput.addEventListener("change", () => {
    selectFile(els.fileInput.files[0]);
    els.fileInput.value = ""; // lets picking the same file again fire "change"
  });

  els.fileClear.addEventListener("click", (e) => {
    e.stopPropagation(); // don't also open the picker
    selectFile(null);
  });

  // Drag & drop. The popup is a normal page, so a file dropped anywhere outside
  // the zone would navigate the popup to the file — block that everywhere.
  els.fileDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.fileDropzone.classList.add("dragover");
  });
  els.fileDropzone.addEventListener("dragleave", () => els.fileDropzone.classList.remove("dragover"));
  els.fileDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.fileDropzone.classList.remove("dragover");
    selectFile(e.dataTransfer.files[0]);
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());
}

function selectFile(file) {
  setFileMessage("");
  stash = null;
  stashPromise = null;

  if (file) {
    if (!FILE_EXTS.includes(fileExtension(file.name))) {
      file = null;
      setFileMessage("Unsupported file. Use MP3, WAV, FLAC, AIFF, M4A, AAC, OGG or OPUS.");
    } else if (file.size > FILE_MAX_BYTES) {
      file = null;
      setFileMessage("File is too large (100 MB max).");
    }
  }

  selectedFile = file;
  els.fileDropzone.classList.toggle("has-file", !!file);
  els.fileClear.classList.toggle("hidden", !file);
  // Nothing to convert until a file is chosen: the buttons stay, greyed out.
  fileGrid.setEnabled(!!file);
  fileResultCard.refresh();
  if (file) startFileAnalysis(); // no button: adding the file is what sends it to Tunebat
  els.fileDropzoneTitle.textContent = file ? file.name : "Drop an audio file here";
  els.fileDropzoneSub.textContent = file
    ? `${formatBytes(file.size)} · click to choose another`
    : "or click to browse";
  els.fileDropzoneFormats.classList.toggle("hidden", !!file);
}

// Uploads the selected file to the local server (once per selection, even if asked twice).
function ensureStash() {
  if (stash) return Promise.resolve(stash);
  if (stashPromise) return stashPromise;
  const file = selectedFile;
  const promise = (async () => {
    const res = await fetch(`${SERVER}/api/stash?ext=${fileExtension(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");
    if (file !== selectedFile) throw new Error("The selected file changed — try again.");
    stash = { name: data.filename, url: `${SERVER}${data.downloadUrl}` };
    return stash;
  })();
  stashPromise = promise;
  promise.catch(() => {
    if (stashPromise === promise) stashPromise = null; // let a later attempt retry
  });
  return promise;
}

// --- Automatic analysis of the added file ---

function fileAnalysisKey() {
  return stash ? FILE_ANALYSIS_PREFIX + stash.url : null;
}

async function fileAnalysisRecord() {
  const key = fileAnalysisKey();
  return key ? (await chrome.storage.local.get(key))[key] || null : null;
}

// Uploads the file (if it isn't yet) and hands it to the background worker for analysis.
async function startFileAnalysis() {
  const file = selectedFile;
  if (!file || !(await getSettings()).analyze.file) return;
  try {
    setFileMessage("Uploading…");
    await ensureStash();
    if (file !== selectedFile) return;
    setFileMessage("");
    await chrome.storage.local.set({ [fileAnalysisKey()]: { analysis: "pending", ts: Date.now() } });
    await requestAnalysis({
      id: newId(),
      standalone: true,
      fileUrl: stash.url,
      format: fileExtension(file.name),
      title: fileBaseName(file.name),
      source: "file",
    });
  } catch (err) {
    if (file === selectedFile) setFileMessage(describeError(err));
  }
}

// The analysis of the current file, waiting a few seconds if it's still running — so a
// conversion started right after adding the file gets BPM and key in its name at once.
async function knownFileAnalysis() {
  let record = await fileAnalysisRecord();
  const deadline = Date.now() + 15000;
  while (record && (record.analysis === "pending" || record.analysis === "analyzing") && Date.now() < deadline) {
    setFileMessage("Waiting for BPM & key…");
    await new Promise((r) => setTimeout(r, 300));
    record = await fileAnalysisRecord();
  }
  return record?.analysis === "done" ? record : null;
}

async function convertStash(format, normalize) {
  const res = await fetch(`${SERVER}/api/convert-stash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stash: stash.name, format, ...normalize }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Unknown error.");
  return { url: `${SERVER}${data.downloadUrl}`, filename: data.filename };
}

async function handleFileConvert(format) {
  if (!selectedFile) return;
  const file = selectedFile;
  fileGrid.setBusy(format);
  try {
    if (!stash) setFileMessage("Uploading…");
    await ensureStash();
    setFileMessage("Converting…");
    const knownPromise = knownFileAnalysis(); // runs alongside the conversion
    const converted = await convertStash(format, await getNormalizeOptions("file"));

    const settings = await getSettings();
    const title = fileBaseName(file.name);
    const known = await knownPromise; // {bpm, key} or null
    const downloadId = await startDownload(
      converted.url,
      `${buildName(settings, { title, format, bpm: known?.bpm, key: known?.key })}.${format}`,
      { source: "file", title, format, bpm: known?.bpm, key: known?.key }
    );
    setFileMessage(
      downloadId === null
        ? "Save cancelled."
        : !known && settings.analyze.file
          ? "Saved — analyzing BPM & key on Tunebat in the background."
          : "Download started — check Chrome's downloads bar."
    );
  } catch (err) {
    setFileMessage(describeError(err));
  } finally {
    fileGrid.setBusy(null);
  }
}

