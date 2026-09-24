// --- Sample tab: record the audio playing in the current tab ---
// Recording itself runs in an offscreen document coordinated by background.js, so
// it keeps going even if this popup closes. This just reflects that state.

let sampleTimerInterval = null;
let sampleElapsedBaseMs = 0;
let sampleElapsedStartedAt = 0;
let lastSampleBlob = null;
// The Tunebat analysis of the recording that was just exported.
const sampleResultCard = createResultCard(els.sampleResultCard, (history) =>
  lastSampleBlob ? history.find((e) => e.source === "sample" && Date.now() - e.ts < 15 * 60 * 1000) || null : null
);

function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

async function initSampleTab() {
  els.sampleRecordBtn.addEventListener("click", handleRecordClick);
  els.sampleBtnDiscard.addEventListener("click", handleDiscardRecording);
  setupSamplePlayer();
  els.sampleBtnTrimSilence.addEventListener("click", trimSilence);

  // Live level meter while recording: offscreen.js broadcasts a volume reading a
  // few times a second (see background.js/offscreen.js) — just reflect it here.
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "sample:level") return;
    if (!els.sampleRecordBtn.classList.contains("recording")) return;
    const pct = Math.min(100, Math.round(message.level * 220));
    els.sampleLevelFill.style.width = `${pct}%`;
  });

  const status = await sendToBackground({ type: "sample:status" });
  // A finished recording (keyboard shortcut) or queue leaves a "✓"/"!" on the toolbar icon;
  // opening the popup is how you pick it up, so clear it.
  if (!status?.recording) {
    chrome.action?.getBadgeText?.({}).then((text) => {
      if (text === "✓" || text === "!") chrome.action.setBadgeText({ text: "" }); // keep a queue's "3 left" count
    });
  }
  if (status?.recording) {
    enterRecordingUI(status.elapsedMs);
    return;
  }

  if (status?.hasLastRecording) {
    const last = await sendToBackground({ type: "sample:getLast" });
    if (last?.recording) {
      showSampleResult(last.recording.audioBase64, last.recording.durationMs);
    }
  }
}

async function handleRecordClick() {
  if (els.sampleRecordBtn.classList.contains("recording")) {
    await stopSampleRecordingFlow();
  } else {
    await startSampleRecordingFlow();
  }
}

async function startSampleRecordingFlow() {
  els.sampleRecordBtn.disabled = true;
  els.sampleStatus.textContent = "Starting…";
  try {
    const res = await sendToBackground({ type: "sample:start" });
    if (!res?.ok) throw new Error(res?.error || "Could not start recording.");
    els.sampleResult.classList.add("hidden");
    enterRecordingUI(0);
  } catch (err) {
    els.sampleStatus.textContent = `Error: ${err.message}`;
  } finally {
    els.sampleRecordBtn.disabled = false;
  }
}

async function stopSampleRecordingFlow() {
  els.sampleRecordBtn.disabled = true;
  els.sampleStatus.textContent = "Stopping…";
  try {
    const res = await sendToBackground({ type: "sample:stop" });
    if (!res?.ok) throw new Error(res?.error || "Could not stop recording.");
    exitRecordingUI();
    showSampleResult(res.audioBase64, res.durationMs);
  } catch (err) {
    els.sampleStatus.textContent = `Error: ${err.message}`;
    exitRecordingUI();
  } finally {
    els.sampleRecordBtn.disabled = false;
  }
}

function enterRecordingUI(elapsedMs) {
  els.sampleRecordBtn.classList.add("recording");
  els.tabSample.classList.add("has-activity");
  els.sampleTimer.classList.remove("hidden");
  els.sampleLevelMeter.classList.remove("hidden");
  els.sampleLevelFill.style.width = "0%";
  els.sampleStatus.textContent = "Recording…";

  sampleElapsedBaseMs = elapsedMs;
  sampleElapsedStartedAt = Date.now();
  els.sampleTimer.textContent = formatTimer(sampleElapsedBaseMs);

  clearInterval(sampleTimerInterval);
  sampleTimerInterval = setInterval(() => {
    const elapsed = sampleElapsedBaseMs + (Date.now() - sampleElapsedStartedAt);
    els.sampleTimer.textContent = formatTimer(elapsed);
  }, 250);
}

function exitRecordingUI() {
  els.sampleRecordBtn.classList.remove("recording");
  els.tabSample.classList.remove("has-activity");
  els.sampleTimer.classList.add("hidden");
  els.sampleLevelMeter.classList.add("hidden");
  clearInterval(sampleTimerInterval);
  sampleTimerInterval = null;
  els.sampleStatus.textContent = "Record the audio playing in this tab.";
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function defaultSampleFilename() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return `Sample ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

// Waveform + playback are combined into one canvas: peaks are computed once
// after decoding, then re-rendered on every playback tick with a "played" vs
// "unplayed" color split (like most audio-editor waveform players).
let waveformPeaks = null;

// The canvas is laid out at a fixed CSS size (popup body is 320px wide minus padding);
// its backing store is scaled by devicePixelRatio so it stays crisp on retina screens.
// Sizes are constants (not measured) because the panel may be hidden when this runs.
const WAVEFORM_CSS_WIDTH = 288;
const WAVEFORM_CSS_HEIGHT = 56;

async function computeWaveformPeaks(blob) {
  const canvas = els.sampleWaveform;
  try {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(WAVEFORM_CSS_WIDTH * dpr);
    canvas.height = Math.round(WAVEFORM_CSS_HEIGHT * dpr);

    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    audioCtx.close();
    silenceBounds = findSoundBounds(audioBuffer);

    const width = canvas.width;
    const samplesPerPixel = Math.max(1, Math.floor(channelData.length / width));
    const peaks = [];
    for (let x = 0; x < width; x++) {
      let min = 1.0;
      let max = -1.0;
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);
      for (let i = start; i < end; i++) {
        const v = channelData[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks.push([min, max]);
    }
    waveformPeaks = peaks;
    renderWaveform(0);
  } catch (err) {
    // Waveform is a nice-to-have; failing to draw it shouldn't block playback/download.
    console.error("Waveform draw failed:", err);
  }
}

// First and last moments of actual sound, for the "Trim silence" button. Scans 20 ms
// windows across all channels for a peak above -40 dBFS. Returns null if it's all silence.
let silenceBounds = null; // { start, end } in seconds

function findSoundBounds(audioBuffer) {
  const THRESHOLD = 0.01; // -40 dBFS
  const windowSize = Math.max(1, Math.round(audioBuffer.sampleRate * 0.02));
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
  const length = audioBuffer.length;
  const isLoud = (from) => {
    const to = Math.min(from + windowSize, length);
    for (const data of channels) {
      for (let i = from; i < to; i++) if (Math.abs(data[i]) > THRESHOLD) return true;
    }
    return false;
  };
  let first = -1;
  for (let i = 0; i < length; i += windowSize) if (isLoud(i)) { first = i; break; }
  if (first === -1) return null;
  let last = first;
  for (let i = Math.floor((length - 1) / windowSize) * windowSize; i >= first; i -= windowSize) {
    if (isLoud(i)) { last = Math.min(i + windowSize, length); break; }
  }
  return { start: first / audioBuffer.sampleRate, end: last / audioBuffer.sampleRate };
}

// Moves the trim handles to the sound, keeping a little air: 50 ms before, 150 ms after
// (so a natural tail isn't clipped).
function trimSilence() {
  if (!silenceBounds || !sampleDurationSec) {
    els.sampleProgress.classList.remove("hidden");
    els.sampleProgress.textContent = "No sound detected to trim to.";
    return;
  }
  const newStart = Math.max(0, silenceBounds.start - 0.05);
  const newEnd = Math.min(sampleDurationSec, silenceBounds.end + 0.15);
  const changed = newStart > trimStart + 0.05 || newEnd < trimEnd - 0.05;
  if (changed) {
    trimStart = Math.max(trimStart, newStart);
    trimEnd = Math.min(trimEnd, newEnd);
    els.sampleAudio.currentTime = trimStart;
    renderWaveform(els.sampleAudio.duration ? trimStart / els.sampleAudio.duration : 0);
  }
  els.sampleProgress.classList.remove("hidden");
  els.sampleProgress.textContent = changed
    ? `Trimmed to ${formatTimer((trimEnd - trimStart) * 1000)} of sound.`
    : "Nothing to trim — the clip already starts and ends on sound.";
}

// Trim handles: drag the edges of the waveform to cut the clip before export.
// Playback loops within [trimStart, trimEnd] so you can preview the trimmed
// result; the actual cut happens server-side (ffmpeg -ss/-to) on download.
let trimStart = 0;
let trimEnd = 0;
let sampleDurationSec = 0;
let draggingHandle = null; // "start" | "end" | null

function timeToX(t, width) {
  return sampleDurationSec ? (t / sampleDurationSec) * width : 0;
}

function xToTime(x, width) {
  if (!sampleDurationSec) return 0;
  return Math.max(0, Math.min(sampleDurationSec, (x / width) * sampleDurationSec));
}

function renderWaveform(progress) {
  if (!waveformPeaks) return;
  const canvas = els.sampleWaveform;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const mid = height / 2;
  const playedX = Math.floor(progress * width);

  ctx.clearRect(0, 0, width, height);
  for (let x = 0; x < width; x++) {
    const [min, max] = waveformPeaks[x];
    const y1 = mid + min * mid * 0.9;
    const y2 = mid + max * mid * 0.9;
    ctx.fillStyle = x < playedX ? "#6c5ce7" : "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }

  if (sampleDurationSec > 0) {
    const startX = timeToX(trimStart, width);
    const endX = timeToX(trimEnd, width);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    if (startX > 0) ctx.fillRect(0, 0, startX, height);
    if (endX < width) ctx.fillRect(endX, 0, width - endX, height);

    const handleW = Math.max(2, Math.round(2 * (window.devicePixelRatio || 1)));
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.max(0, startX - handleW / 2), 0, handleW, height);
    ctx.fillRect(Math.min(width - handleW, endX - handleW / 2), 0, handleW, height);
  }
}

const TRIM_HANDLE_HIT_PX = 8;

function setupSamplePlayer() {
  els.samplePlayBtn.addEventListener("click", () => {
    if (els.sampleAudio.paused) {
      if (els.sampleAudio.currentTime < trimStart || els.sampleAudio.currentTime >= trimEnd) {
        els.sampleAudio.currentTime = trimStart;
      }
      els.sampleAudio.play();
    } else {
      els.sampleAudio.pause();
    }
  });
  let playheadFrame = null;
  els.sampleAudio.addEventListener("play", () => {
    els.samplePlayBtn.classList.add("playing");
    // "timeupdate" only fires ~4x/second, which makes the playhead visibly step;
    // while playing, redraw every animation frame instead.
    const loop = () => {
      syncPlayhead();
      if (!els.sampleAudio.paused) playheadFrame = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(playheadFrame);
    playheadFrame = requestAnimationFrame(loop);
  });
  els.sampleAudio.addEventListener("pause", () => {
    els.samplePlayBtn.classList.remove("playing");
    cancelAnimationFrame(playheadFrame);
  });
  els.sampleAudio.addEventListener("loadedmetadata", () => {
    sampleDurationSec = els.sampleAudio.duration || 0;
    trimStart = 0;
    trimEnd = sampleDurationSec;
    renderWaveform(0);
  });
  els.sampleAudio.addEventListener("ended", () => {
    els.samplePlayBtn.classList.remove("playing");
    renderWaveform(0);
  });
  function syncPlayhead() {
    if (!els.sampleAudio.duration) return;
    if (trimEnd > 0 && els.sampleAudio.currentTime >= trimEnd) {
      els.sampleAudio.pause();
      els.sampleAudio.currentTime = trimStart;
      renderWaveform(trimStart / els.sampleAudio.duration);
      return;
    }
    renderWaveform(els.sampleAudio.currentTime / els.sampleAudio.duration);
  }
  els.sampleAudio.addEventListener("timeupdate", syncPlayhead); // covers seeking while paused

  els.sampleWaveform.addEventListener("mousedown", (e) => {
    if (!sampleDurationSec) return;
    const rect = els.sampleWaveform.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startX = timeToX(trimStart, rect.width);
    const endX = timeToX(trimEnd, rect.width);

    if (Math.abs(x - startX) <= TRIM_HANDLE_HIT_PX) {
      draggingHandle = "start";
    } else if (Math.abs(x - endX) <= TRIM_HANDLE_HIT_PX) {
      draggingHandle = "end";
    } else {
      draggingHandle = null;
      const fraction = x / rect.width;
      els.sampleAudio.currentTime = fraction * sampleDurationSec;
    }
  });
  els.sampleWaveform.addEventListener("dblclick", () => {
    trimStart = 0;
    trimEnd = sampleDurationSec;
    renderWaveform(els.sampleAudio.duration ? els.sampleAudio.currentTime / els.sampleAudio.duration : 0);
  });
  document.addEventListener("mousemove", (e) => {
    if (!draggingHandle) return;
    const rect = els.sampleWaveform.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const t = xToTime(x, rect.width);
    if (draggingHandle === "start") {
      trimStart = Math.max(0, Math.min(t, trimEnd - 0.1));
    } else {
      trimEnd = Math.min(sampleDurationSec, Math.max(t, trimStart + 0.1));
    }
    renderWaveform(els.sampleAudio.duration ? els.sampleAudio.currentTime / els.sampleAudio.duration : 0);
  });
  document.addEventListener("mouseup", () => {
    draggingHandle = null;
  });
}

function showSampleResult(audioBase64, durationMs) {
  lastSampleBlob = base64ToBlob(audioBase64, "audio/webm");
  els.sampleAudio.src = URL.createObjectURL(lastSampleBlob);
  els.sampleAudio.pause();
  els.samplePlayBtn.classList.remove("playing");
  els.sampleResult.classList.remove("hidden");
  els.sampleFilename.value = defaultSampleFilename();

  const durationLabel = typeof durationMs === "number" ? ` (${formatTimer(durationMs)})` : "";
  els.sampleStatus.textContent = `Recording ready${durationLabel}.`;

  computeWaveformPeaks(lastSampleBlob);
}

async function handleSampleDownload(format) {
  if (!lastSampleBlob) return;

  sampleGrid.setBusy(format);
  els.sampleProgress.classList.remove("hidden");
  els.sampleProgress.textContent = "Converting and downloading...";

  try {
    // Sends the raw recorded bytes directly (not JSON+base64) — cheaper for a
    // several-MB recording, and reuses the Blob we already built for playback.
    // Only send trim bounds if the user actually moved a handle — otherwise let
    // the server skip trimming instead of re-encoding the exact same range.
    let trimParams = "";
    if (sampleDurationSec > 0 && (trimStart > 0.05 || trimEnd < sampleDurationSec - 0.05)) {
      trimParams = `&trimStart=${trimStart.toFixed(2)}&trimEnd=${trimEnd.toFixed(2)}`;
    }
    // Fades: the server needs the source length to place a fade-out when nothing is trimmed.
    const fadeIn = Number(els.sampleFadeIn.value) || 0;
    const fadeOut = Number(els.sampleFadeOut.value) || 0;
    const fadeParams = fadeIn || fadeOut
      ? `&fadeIn=${fadeIn}&fadeOut=${fadeOut}&duration=${sampleDurationSec.toFixed(3)}`
      : "";
    const { loudnorm, targetLufs } = await getNormalizeOptions("sample");
    const res = await fetch(
      `${SERVER}/api/upload-convert?format=${format}&sourceExt=webm&loudnorm=${loudnorm}&targetLufs=${targetLufs}${trimParams}${fadeParams}`,
      { method: "POST", body: lastSampleBlob }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error.");

    // The name field is the "Beat name" block; the rest of the name follows the user's blocks.
    const title = (els.sampleFilename.value || "sample").trim().replace(/[\\/:*?"<>|]/g, "_") || "sample";
    const settings = await getSettings();
    const filename = `${buildName(settings, { title, format })}.${format}`;

    const downloadId = await startDownload(`${SERVER}${data.downloadUrl}`, filename, { source: "sample", title, format });
    els.sampleProgress.textContent =
      downloadId === null
        ? "Save cancelled."
        : settings.analyze
          ? "Saved — analyzing BPM & key on Tunebat in the background."
          : "Download started — check Chrome's downloads bar.";
    sampleResultCard.refresh();
  } catch (err) {
    els.sampleProgress.textContent = `Error: ${err.message}`;
  } finally {
    sampleGrid.setBusy(null);
  }
}

async function handleDiscardRecording() {
  await sendToBackground({ type: "sample:discard" });
  lastSampleBlob = null;
  waveformPeaks = null;
  trimStart = 0;
  trimEnd = 0;
  sampleDurationSec = 0;
  silenceBounds = null;
  els.sampleFadeIn.value = "0";
  els.sampleFadeOut.value = "0";
  els.sampleResult.classList.add("hidden");
  els.sampleAudio.pause();
  els.sampleAudio.removeAttribute("src");
  els.samplePlayBtn.classList.remove("playing");
  els.sampleFilename.value = "";
  els.sampleWaveform.getContext("2d").clearRect(0, 0, els.sampleWaveform.width, els.sampleWaveform.height);
  sampleResultCard.refresh();
  els.sampleStatus.textContent = "Record the audio playing in this tab.";
}

