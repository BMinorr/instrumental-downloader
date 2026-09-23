// Runs in a hidden offscreen document (has a real DOM/AudioContext, unlike the
// background service worker) so tab-audio recording keeps going even while the
// service worker is idle/restarted and the popup is closed.

let stream = null;
let audioContext = null;
let mediaRecorder = null;
let recordedChunks = [];
let startTime = null;
let analyser = null;
let levelInterval = null;

// Kept in memory (not chrome.storage — session storage caps out at 10MB, which a
// several-minute recording can exceed) so the popup can re-fetch it after being
// closed and reopened, without ever persisting the full audio to disk/storage.
let lastRecordedBlob = null;
let lastRecordingDurationMs = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function startRecording(streamId) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    throw new Error("Already recording.");
  }

  lastRecordedBlob = null;
  lastRecordingDurationMs = null;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });

  // Capturing tab audio this way mutes the tab by default — pipe it back out to
  // speakers so the client's instrumental keeps playing while we record it.
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(audioContext.destination);

  // Cheap live level meter: broadcast the current volume a few times a second so
  // the popup can show something's actually being captured (no live waveform
  // streaming needed — a single number per tick is enough for a level bar).
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const levelData = new Uint8Array(analyser.frequencyBinCount);
  levelInterval = setInterval(() => {
    analyser.getByteTimeDomainData(levelData);
    let sumSquares = 0;
    for (let i = 0; i < levelData.length; i++) {
      const v = (levelData[i] - 128) / 128;
      sumSquares += v * v;
    }
    const level = Math.sqrt(sumSquares / levelData.length); // RMS, ~0 (silence) to ~1 (loud)
    chrome.runtime.sendMessage({ type: "sample:level", level }).catch(() => {});
  }, 150);

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  startTime = Date.now();
  mediaRecorder.start(1000);
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      reject(new Error("Not recording."));
      return;
    }
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        const durationMs = Date.now() - startTime;
        cleanupStream();
        lastRecordedBlob = blob;
        lastRecordingDurationMs = durationMs;
        const arrayBuffer = await blob.arrayBuffer();
        const audioBase64 = arrayBufferToBase64(arrayBuffer);
        resolve({ audioBase64, durationMs });
      } catch (err) {
        reject(err);
      }
    };
    mediaRecorder.stop();
  });
}

async function getLastRecording() {
  if (!lastRecordedBlob) return null;
  const arrayBuffer = await lastRecordedBlob.arrayBuffer();
  return { audioBase64: arrayBufferToBase64(arrayBuffer), durationMs: lastRecordingDurationMs };
}

function discardRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  cleanupStream();
  lastRecordedBlob = null;
  lastRecordingDurationMs = null;
}

function cleanupStream() {
  if (levelInterval) {
    clearInterval(levelInterval);
    levelInterval = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  mediaRecorder = null;
  analyser = null;
  recordedChunks = [];
  startTime = null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  (async () => {
    try {
      if (message.type === "start") {
        await startRecording(message.streamId);
        sendResponse({ ok: true });
      } else if (message.type === "stop") {
        const result = await stopRecording();
        sendResponse({ ok: true, ...result });
      } else if (message.type === "discard") {
        discardRecording();
        sendResponse({ ok: true });
      } else if (message.type === "status") {
        sendResponse({
          ok: true,
          recording: !!mediaRecorder && mediaRecorder.state === "recording",
          elapsedMs: startTime ? Date.now() - startTime : 0,
          hasLastRecording: !!lastRecordedBlob,
        });
      } else if (message.type === "getLast") {
        const last = await getLastRecording();
        sendResponse({ ok: true, recording: last });
      } else {
        sendResponse({ ok: false, error: "Unknown message type." });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // async response
});
