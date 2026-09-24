// --- File tab: pick/drop a local audio file, then convert it or analyze it on Tunebat ---
// The file is copied to the local server once (POST /api/stash) the first time it's needed
// and reused for every conversion after that. It has to go through the server for Tunebat
// too: the popup closes the moment the Tunebat tab opens, so the background worker fetches
// the bytes by URL instead.

const FILE_EXTS = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "aiff", "aif", "opus"]; // /api/stash whitelist
const TUNEBAT_EXTS = ["mp3", "wav", "flac", "aac", "ogg", "m4a"]; // what Tunebat's uploader accepts
const FILE_MAX_BYTES = 100 * 1024 * 1024; // matches the server's /api/stash limit
let selectedFile = null;
let stash = null; // server copy of selectedFile: { name, url } — null until first upload

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

  const openTunebat = makeTunebatHandler(els.btnFileTunebat, els.fileProgress);
  els.btnFileTunebat.addEventListener("click", async () => {
    if (!selectedFile) return;
    if (!els.btnFileTunebat.dataset.fileUrl && !(await prepareTunebatFile())) return;
    openTunebat();
  });
}

function selectFile(file) {
  setFileMessage("");
  stash = null;
  delete els.btnFileTunebat.dataset.fileUrl;
  delete els.btnFileTunebat.dataset.filename;

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
  // Nothing to convert or analyze until a file is chosen.
  els.fileFormatOptions.classList.toggle("hidden", !file);
  els.btnFileTunebat.classList.toggle("hidden", !file);
  els.fileDropzoneTitle.textContent = file ? file.name : "Drop an audio file here";
  els.fileDropzoneSub.textContent = file
    ? `${formatBytes(file.size)} · click to choose another`
    : "or click to browse";
  els.fileDropzoneFormats.classList.toggle("hidden", !!file);
}

// Uploads the selected file to the local server (once per selection).
async function ensureStash() {
  if (stash) return stash;
  const file = selectedFile;
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
  els.btnFileTunebat.disabled = true;
  try {
    if (!stash) setFileMessage("Uploading…");
    await ensureStash();
    setFileMessage("Converting…");
    const converted = await convertStash(format, await getNormalizeOptions("file"));

    const downloadId = await startDownload(converted.url, `${fileBaseName(file.name)}.${format}`, {
      source: "file",
      title: fileBaseName(file.name),
      format,
    });
    setFileMessage(
      downloadId === null ? "Save cancelled." : "Download started — check Chrome's downloads bar."
    );
  } catch (err) {
    setFileMessage(describeError(err));
  } finally {
    fileGrid.setBusy(null);
    els.btnFileTunebat.disabled = false;
  }
}

// Points the Tunebat button at a file Tunebat will accept: the stashed copy as-is, or —
// for types its uploader rejects (AIFF, OPUS) — a WAV made from it first (never
// normalized: this is just a container change so the analysis sees the original audio).
async function prepareTunebatFile() {
  const button = els.btnFileTunebat;
  const originalLabel = button.textContent;
  const file = selectedFile;
  button.disabled = true;
  fileGrid.setBusy(""); // dims the format buttons too (no id matches, so none spins)
  try {
    button.textContent = "Uploading…";
    await ensureStash();
    if (TUNEBAT_EXTS.includes(fileExtension(file.name))) {
      button.dataset.fileUrl = stash.url;
      button.dataset.filename = file.name;
    } else {
      button.textContent = "Converting…";
      const converted = await convertStash("wav", { loudnorm: false });
      button.dataset.fileUrl = converted.url;
      button.dataset.filename = `${fileBaseName(file.name)}.wav`;
    }
    return true;
  } catch (err) {
    setFileMessage(describeError(err));
    return false;
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
    fileGrid.setBusy(null);
  }
}

