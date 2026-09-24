const { spawn } = require("child_process");
const { runYtDlp } = require("./ytdlp");

// yt-dlp breaks whenever YouTube/Instagram change something, and the fix is nearly always a
// newer yt-dlp. This lets the extension show the installed version, check for a newer one
// and update it — using the same tool the user installed it with. Only fixed commands are
// ever run (nothing from a request ends up in a command line).

function run(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout.on("data", (c) => (output += c));
    proc.stderr.on("data", (c) => (output += c));
    proc.on("error", (err) => reject(err.code === "ENOENT" ? new Error(`${command} nu a fost găsit.`) : err));
    proc.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output.trim().split("\n").slice(-4).join("\n") || `${command} a eșuat cu codul ${code}`));
    });
  });
}

async function installedVersion() {
  const { stdout } = await runYtDlp(["--version"]);
  return stdout.trim();
}

// "2026.08.19" / "2026.08.19.1" -> comparable arrays
function versionParts(v) {
  return String(v).split(".").map((n) => Number(n) || 0);
}

function isNewer(latest, current) {
  const a = versionParts(latest);
  const b = versionParts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

let latestCache = { at: 0, value: null };
async function latestVersion() {
  if (Date.now() - latestCache.at < 60 * 60 * 1000) return latestCache.value;
  try {
    const res = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
      headers: { "User-Agent": "InstrumentalDownloader/1.0", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const tag = (await res.json()).tag_name;
    latestCache = { at: Date.now(), value: typeof tag === "string" ? tag.replace(/^v/, "") : null };
  } catch {
    latestCache = { at: Date.now() - 55 * 60 * 1000, value: null }; // offline: retry in ~5 min
  }
  return latestCache.value;
}

async function locateYtDlp() {
  try {
    const out = await run(process.platform === "win32" ? "where" : "which", ["yt-dlp"]);
    return out.trim().split(/\r?\n/)[0];
  } catch {
    return "";
  }
}

// How this yt-dlp was installed decides how it must be updated.
async function detectMethod() {
  const location = await locateYtDlp();
  if (process.platform === "win32") return /winget/i.test(location) ? "winget" : "self";
  if (/^\/opt\/homebrew\/|\/Cellar\/|linuxbrew/.test(location) || location === "/usr/local/bin/yt-dlp") return "brew";
  return "self"; // standalone binary: `yt-dlp -U`
}

async function getStatus() {
  const [version, latest, method] = await Promise.all([installedVersion(), latestVersion(), detectMethod()]);
  return {
    version,
    latest,
    updateAvailable: latest ? isNewer(latest, version) : false,
    method,
  };
}

let updating = null;
function update() {
  if (updating) return updating;
  updating = (async () => {
    const method = await detectMethod();
    let output = "";
    if (method === "brew") {
      output = await run("brew", ["upgrade", "yt-dlp"]);
    } else if (method === "winget") {
      output = await run("winget", [
        "upgrade", "--id", "yt-dlp.yt-dlp", "--silent",
        "--accept-source-agreements", "--accept-package-agreements",
      ]);
    } else {
      output = (await runYtDlp(["-U"])).stdout;
    }
    latestCache = { at: 0, value: null };
    return { ...(await getStatus()), output: output.trim().split("\n").slice(-6).join("\n") };
  })().finally(() => {
    updating = null;
  });
  return updating;
}

module.exports = { getStatus, update, isNewer, detectMethod };
