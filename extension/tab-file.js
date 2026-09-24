// --- File tab: pick/drop a local audio file, then convert it ---
// The file is copied to the local server once (POST /api/stash) the first time it's needed
// and reused for every conversion after that.

const FILE_EXTS = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "aiff", "aif", "opus"]; // /api/stash whitelist
const FILE_MAX_BYTES = 100 * 1024 * 1024; // matches the server's /api/stash limit
let selectedFile = null;
// The Tunebat analysis of the file that was just converted (History has the full record).
const fileResultCard = createResultCard(els.fileResultCard, (history) => {
  if (!selectedFile) return null;
  const title = fileBaseName(selectedFile.name);
  return history.find((e) => e.source === "file" && e.title === title && Date.now() - e.ts < 15 * 60 * 1000) || null;
});
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
}

function selectFile(file) {
  setFileMessage("");
  stash = null;

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
  // Nothing to convert until a file is chosen.
  els.fileFormatOptions.classList.toggle("hidden", !file);
  fileResultCard.refresh();
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
  try {
    if (!stash) setFileMessage("Uploading…");
    await ensureStash();
    setFileMessage("Converting…");
    const converted = await convertStash(format, await getNormalizeOptions("file"));

    const settings = await getSettings();
    const title = fileBaseName(file.name);
    const downloadId = await startDownload(converted.url, `${buildName(settings, { title, format })}.${format}`, {
      source: "file",
      title,
      format,
    });
    setFileMessage(
      downloadId === null
        ? "Save cancelled."
        : settings.analyze
          ? "Saved — analyzing BPM & key on Tunebat in the background."
          : "Download started — check Chrome's downloads bar."
    );
    fileResultCard.refresh();
  } catch (err) {
    setFileMessage(describeError(err));
  } finally {
    fileGrid.setBusy(null);
  }
}

