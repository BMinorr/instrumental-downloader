const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Updates this tool itself (extension + server) from its Git repository, the same way
// yt-dlp is updated from Settings. Only fixed git/npm commands are run — nothing from a
// request ends up in a command line. A folder without `.git` (downloaded as a zip) can't
// update itself; the status says so.

const ROOT = path.resolve(__dirname, "..", "..");
const SERVER_DIR = path.join(ROOT, "server");
const LAUNCHD_LABEL = "com.studio.instrumentaldownloader";

function run(command, args, { cwd = ROOT, timeout = 20000, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      shell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, // never wait for a password prompt
    });
    let output = "";
    const timer = setTimeout(() => proc.kill(), timeout);
    proc.stdout.on("data", (c) => (output += c));
    proc.stderr.on("data", (c) => (output += c));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new Error(`${command} was not found.`) : err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(output.trim().split("\n").slice(-4).join("\n") || `${command} failed (exit code ${code})`));
    });
  });
}

const git = (args, options) => run("git", args, options);

function localVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8")).version;
  } catch {
    return "";
  }
}

let lastFetch = { at: 0, ok: false };

// `check: false` only reads what is installed (no network).
async function getStatus({ check = true } = {}) {
  const version = localVersion();
  if (!fs.existsSync(path.join(ROOT, ".git"))) return { version, method: "manual", checked: false, updateAvailable: false };

  const commit = await git(["rev-parse", "--short", "HEAD"]);
  const status = { version, commit, method: "git", checked: false, updateAvailable: false, behind: 0, latest: "" };
  if (!check) return status;

  // A fetch per popup open would be wasteful: reuse the last result for 10 minutes.
  if (Date.now() - lastFetch.at > 10 * 60 * 1000) {
    try {
      await git(["fetch", "--quiet", "origin"], { timeout: 15000 });
      lastFetch = { at: Date.now(), ok: true };
    } catch {
      lastFetch = { at: Date.now() - 5 * 60 * 1000, ok: false }; // offline / no access: retry in ~5 min
    }
  }
  if (!lastFetch.ok) return status;

  try {
    const behind = Number(await git(["rev-list", "--count", "HEAD..@{u}"]));
    status.checked = true;
    status.behind = behind;
    status.updateAvailable = behind > 0;
    if (behind > 0) status.latest = await git(["log", "-1", "--format=%s", "@{u}"]);
  } catch {
    // no upstream branch configured: treated as "couldn't check"
  }
  return status;
}

let updating = null;
function update() {
  if (updating) return updating;
  updating = (async () => {
    if (!fs.existsSync(path.join(ROOT, ".git"))) throw new Error("This copy was not installed with Git, so it can't update itself.");
    const before = await git(["rev-parse", "HEAD"]);
    try {
      await git(["pull", "--ff-only", "--quiet"], { timeout: 60000 });
    } catch (err) {
      if (/local changes|would be overwritten/i.test(err.message)) throw new Error("Files in the project folder were edited by hand, which blocks the update.");
      if (/not possible to fast-forward|diverging/i.test(err.message)) throw new Error("This copy has its own commits, so it can't fast-forward.");
      throw err;
    }
    const after = await git(["rev-parse", "HEAD"]);
    lastFetch = { at: 0, ok: false };
    if (before === after) return { updated: false, extensionChanged: false, restarting: false };

    const changed = (await git(["diff", "--name-only", before, after])).split("\n").filter(Boolean);
    const extensionChanged = changed.some((f) => f.startsWith("extension/"));
    const serverChanged = changed.some((f) => f.startsWith("server/"));
    if (changed.some((f) => f === "server/package.json" || f === "server/package-lock.json")) {
      // `npm` is npm.cmd on Windows, which only runs through a shell (fixed arguments only)
      await run("npm", ["install", "--no-audit", "--no-fund"], { cwd: SERVER_DIR, timeout: 180000, shell: process.platform === "win32" });
    }
    return { updated: true, extensionChanged, restarting: serverChanged };
  })().finally(() => {
    updating = null;
  });
  return updating;
}

// Restarts this server so it runs the new code. Under launchd (Mac) a non-zero exit makes it
// start the server again (KeepAlive). Elsewhere (Windows Task Scheduler, manual start) a small
// detached helper waits for this process to free the port and starts a fresh one.
function restart() {
  setTimeout(() => {
    if (process.platform === "darwin" && process.env.XPC_SERVICE_NAME === LAUNCHD_LABEL) process.exit(1);
    const helper =
      "setTimeout(() => {" +
      "require('child_process').spawn(process.execPath, [process.argv[1]], { cwd: process.argv[2], detached: true, stdio: 'ignore', windowsHide: true }).unref();" +
      "}, 1500);";
    spawn(process.execPath, ["-e", helper, path.join(SERVER_DIR, "server.js"), SERVER_DIR], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    process.exit(0);
  }, 300);
}

module.exports = { getStatus, update, restart };
