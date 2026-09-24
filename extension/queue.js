// Queue tab (popup side): paste links / a playlist, pick a format, watch progress. The work
// itself runs in the background worker (queue-engine.js) — this only sends commands and
// renders chrome.storage.local["queue"] live. Loaded before popup.js; `els`, `SERVER`,
// `FORMATS`, `getSettings`, `detectPlatform`, `sendToBackground` come from the other scripts
// and are only touched at call time.

const PLAYLIST_LINK_RE =
  /^https?:\/\/(www\.|m\.)?youtube\.com\/(playlist\?(\S*&)?list=[\w-]+|watch\?(\S*&)?v=[\w-]{6,}\S*[&?]list=[\w-]+)/i;
const QUEUE_FORMAT_KEY = "settings.queueFormat";

function parseLinks(text) {
  const found = String(text).match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(found)];
}

function setQueueMessage(text) {
  els.queueMessage.textContent = text;
  els.queueMessage.classList.toggle("hidden", !text);
}

async function initQueueTab() {
  els.queueAdd.addEventListener("click", addToQueue);
  els.queueInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addToQueue();
  });
  els.queueRetry.addEventListener("click", () => sendToBackground({ type: "queue:retry" }));
  els.queueClearDone.addEventListener("click", () => sendToBackground({ type: "queue:clear", scope: "done" }));
  els.queueClearAll.addEventListener("click", () => sendToBackground({ type: "queue:clear", scope: "all" }));

  const [settings, stored] = await Promise.all([getSettings(), chrome.storage.local.get(QUEUE_FORMAT_KEY)]);
  buildQueueFormatSelect(settings.formats, stored[QUEUE_FORMAT_KEY]);
  els.queueFormat.addEventListener("change", () => chrome.storage.local.set({ [QUEUE_FORMAT_KEY]: els.queueFormat.value }));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[QUEUE_KEY]) renderQueue();
    if (area === "local" && changes[SETTING_KEYS.formats]) buildQueueFormatSelect(validFormatIds(changes[SETTING_KEYS.formats].newValue), els.queueFormat.value);
  });
  renderQueue();
}

function buildQueueFormatSelect(visibleIds, preferred) {
  els.queueFormat.replaceChildren();
  for (const format of FORMATS.filter((f) => visibleIds.includes(f.id))) {
    const option = document.createElement("option");
    option.value = format.id;
    option.textContent = `${format.label} · ${format.sub}`;
    els.queueFormat.appendChild(option);
  }
  els.queueFormat.value = visibleIds.includes(preferred) ? preferred : visibleIds[0];
}

async function addToQueue() {
  const urls = parseLinks(els.queueInput.value);
  if (!urls.length) {
    setQueueMessage("Paste at least one link (one per line).");
    return;
  }

  els.queueAdd.disabled = true;
  try {
    const items = [];
    const notes = [];
    let skipped = 0;
    for (const url of urls) {
      if (PLAYLIST_LINK_RE.test(url)) {
        setQueueMessage("Reading the playlist…");
        try {
          const res = await fetch(`${SERVER}/api/playlist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Unknown error.");
          items.push(...data.items.map(({ url: itemUrl, title, uploader }) => ({ url: itemUrl, title, uploader })));
          if (data.truncated) notes.push(`Only the first ${data.items.length} videos of “${data.title}” were added.`);
        } catch (err) {
          notes.push(err instanceof TypeError ? "Can't reach the local server." : `Couldn't read a playlist: ${withYtdlpHint(err.message)}`);
        }
      } else if (detectPlatform(url) !== "unknown") {
        items.push({ url });
      } else {
        skipped++;
      }
    }
    if (skipped) notes.push(`${skipped} link${skipped > 1 ? "s" : ""} skipped (not YouTube, Spotify or Instagram).`);

    if (!items.length) {
      setQueueMessage(notes.join(" ") || "Nothing to add.");
      return;
    }
    const response = await sendToBackground({ type: "queue:add", items, format: els.queueFormat.value });
    if (!response?.ok) throw new Error(response?.error || "Unknown error.");
    els.queueInput.value = "";
    const already = items.length - response.added;
    setQueueMessage(
      [`Added ${response.added} to the queue.`, already > 0 ? `${already} already in the queue.` : "", ...notes]
        .filter(Boolean)
        .join(" ")
    );
  } catch (err) {
    setQueueMessage(`Error: ${err.message}`);
  } finally {
    els.queueAdd.disabled = false;
  }
}

const QUEUE_ICONS = {
  queued: '<span class="queue-dot"></span>',
  working: '<span class="spinner small"></span>',
  done:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="13"></line><circle cx="12" cy="16.5" r="0.6"></circle></svg>',
};

async function renderQueue() {
  const items = (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || [];
  const count = (status) => items.filter((i) => i.status === status).length;
  const pending = count("queued") + count("working");

  els.tabQueue.classList.toggle("has-activity", pending > 0);
  els.queueList.replaceChildren();
  els.queueEmpty.classList.toggle("hidden", items.length > 0);
  els.queueFooter.classList.toggle("hidden", items.length === 0);
  els.queueRetry.classList.toggle("hidden", count("error") === 0);
  els.queueClearDone.classList.toggle("hidden", count("done") === 0);

  els.queueSummary.textContent = items.length
    ? `${count("done")} of ${items.length} done${count("error") ? ` · ${count("error")} failed` : ""}${pending ? " · working…" : ""}`
    : "";

  for (const item of items) {
    const row = document.createElement("li");
    row.className = `queue-item queue-${item.status}`;

    const icon = document.createElement("span");
    icon.className = "queue-icon";
    icon.innerHTML = QUEUE_ICONS[item.status] || "";

    const info = document.createElement("div");
    info.className = "history-info";
    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = item.title || item.url.replace(/^https?:\/\/(www\.)?/, "");
    title.title = item.url;
    const meta = document.createElement("p");
    meta.className = "meta queue-meta";
    const detail =
      item.status === "error" ? item.error
      : item.status === "working" ? item.step
      : item.status === "queued" ? "Waiting"
      : "Saved";
    meta.textContent = `${item.format.toUpperCase()} · ${detail}`;
    info.append(title, meta);

    row.append(icon, info);
    if (item.status === "error") {
      row.appendChild(iconButton(RETRY_ICON, "Retry", () => sendToBackground({ type: "queue:retry", id: item.id })));
    }
    if (item.status !== "working") {
      row.appendChild(iconButton(REMOVE_ICON, "Remove", () => sendToBackground({ type: "queue:remove", id: item.id })));
    }
    els.queueList.appendChild(row);
  }
}

const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const RETRY_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
