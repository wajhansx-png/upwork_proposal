/**
 * The GiveLife Counter browser add-on, as plain files. The download route zips these.
 *
 * SAFE BY DESIGN:
 *  - It only WATCHES. It never sends a message, clicks, types, or auto-replies. She sends every DM by hand.
 *  - It reads only one attribute per message (the WhatsApp "data-id"), which holds the number, the direction
 *    and a message id. It never reads message text, photos, or any other chat.
 *  - It only works on individual donor chats (@c.us). Groups are ignored.
 *  - It talks only to the GiveLife app, never to WhatsApp's servers.
 */

const MANIFEST = `{
  "manifest_version": 3,
  "name": "GiveLife Counter",
  "version": "1.0.0",
  "description": "Counts your donor DMs for the GiveLife app. It only watches — it never sends anything.",
  "permissions": ["storage", "alarms"],
  "host_permissions": ["https://web.whatsapp.com/*", "APP_ORIGIN/*"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{ "matches": ["https://web.whatsapp.com/*"], "js": ["content.js"], "run_at": "document_idle" }],
  "action": { "default_popup": "popup.html", "default_title": "GiveLife Counter" }
}`;

const BACKGROUND = `// Receives what the content script saw, batches it, and sends it to the GiveLife app.
// Chrome stops this background worker whenever it is idle, so events waiting to be sent are kept in storage too.
let queue = [];
let inflight = [];
let timer = null;
let ready = null;

function load() {
  if (!ready) ready = chrome.storage.local.get(["queue"]).then((s) => { queue = (Array.isArray(s.queue) ? s.queue : []).concat(queue).slice(-1000); }).catch(() => undefined);
  return ready;
}
function save() { return Promise.resolve(chrome.storage.local.set({ queue: inflight.concat(queue) })).catch(() => undefined); }

async function cfg() {
  const s = await chrome.storage.local.get(["app", "token", "role", "on", "unknownCount"]);
  return { app: s.app || "", token: s.token || "", role: s.role || "teammate", on: s.on !== false, unknown: s.unknownCount || 0 };
}

function later(ms) { if (!timer) timer = setTimeout(flush, ms); }
function retryLater() {
  later(15000);
  // The worker can be stopped while it waits, so ask Chrome to wake it up too.
  if (chrome.alarms) chrome.alarms.create("gc-retry", { delayInMinutes: 0.5 });
}

async function flush() {
  timer = null;
  await load();
  const c = await cfg();
  if (!c.on) { if (queue.length) { queue = []; await save(); } return; }
  if (!c.app || !c.token || !queue.length) return;
  inflight = queue.splice(0, 200);
  let retry = false;
  try {
    const res = await fetch(c.app.replace(/\\/$/, "") + "/api/counter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: c.token, from: c.role, events: inflight }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok !== false) {
      await chrome.storage.local.set({ lastError: "", lastOkAt: Date.now(), lastCount: (j.counted || 0), unknownCount: c.unknown + (j.unknown || 0) });
    } else if (res.status === 401 || res.status === 403 || (res.ok && j.ok === false)) {
      // The app said no (switched off, or a wrong code). Drop them and do not retry forever.
      await chrome.storage.local.set({ lastError: (j && j.error) || ("off or wrong token (" + res.status + ")"), lastOkAt: 0 });
    } else {
      // The app is busy or broken for a moment (5xx, too many requests). That is not "off": keep them.
      retry = true;
      await chrome.storage.local.set({ lastError: "the app is busy (" + res.status + "), will retry" });
    }
  } catch (e) {
    // No internet: keep them and try again. The app ignores repeats, so nothing is counted twice.
    retry = true;
    await chrome.storage.local.set({ lastError: "no internet, will retry" });
  }
  if (retry) queue = inflight.concat(queue).slice(-1000);
  inflight = [];
  await save();
  if (retry) retryLater();
  else if (queue.length) later(1000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "events" && Array.isArray(msg.events)) {
    load().then(() => {
      for (const e of msg.events.slice(0, 500)) queue.push(e);
      if (queue.length > 1000) queue = queue.slice(-1000);
      save();
      later(1500);
    });
  }
  // Answer at once, so the page knows the add-on got it.
  if (typeof sendResponse === "function") sendResponse({ ok: true });
});

// Pairing or switching on: send what was waiting.
if (chrome.storage.onChanged) chrome.storage.onChanged.addListener((ch) => { if (ch.app || ch.token || ch.on) later(500); });
if (chrome.alarms) chrome.alarms.onAlarm.addListener((a) => { if (a.name === "gc-retry") later(0); });
// The worker just started: send anything left over from before it was stopped.
load().then(() => { if (queue.length) later(1000); });`;

const CONTENT = `// Watches the open WhatsApp chat and reports which donor DMs were sent or replied.
// It reads ONLY the "data-id" of each message bubble. It never reads message text.
(function () {
  const SEEN_MAX = 20000; // ids remembered on this page
  const HISTORY_BURST = 3; // more new bubbles than this at once is a chat opening
  const QUIET_AT_START = 8000; // WhatsApp is still loading its chats
  const QUIET_AFTER_HISTORY = 2500; // old messages often arrive in several pieces
  const SWAP_WINDOW = 2000; // after another chat's bubbles go away, new ones are the next chat
  const seen = new Set();
  let on = true;
  let dead = false;
  let cfg = { app: "", token: "", lastError: "" };

  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;z-index:99999;right:12px;bottom:12px;color:#fff;font:600 12px system-ui;padding:6px 10px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.3);opacity:.9";
  // The badge tells the truth: green only when it is paired and the last send worked.
  function paint() {
    let text = "GiveLife Counter ON";
    let bad = false;
    if (dead) { text = "GiveLife Counter: reload this page"; bad = true; }
    else if (!cfg.app || !cfg.token) { text = "GiveLife Counter: not paired - open the add-on"; bad = true; }
    else if (cfg.lastError) { text = "GiveLife Counter: problem - open the add-on"; bad = true; }
    badge.textContent = text;
    badge.style.background = bad ? "#c9731a" : "#1f8f72";
  }
  function showBadge() { if (on && document.body && !badge.isConnected) document.body.appendChild(badge); }
  function alive() { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } }

  chrome.storage.local.get(["on", "app", "token", "lastError"], (s) => {
    on = s.on !== false;
    cfg = { app: s.app || "", token: s.token || "", lastError: s.lastError || "" };
    paint();
    showBadge();
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.on) on = ch.on.newValue !== false;
    if (ch.app) cfg.app = ch.app.newValue || "";
    if (ch.token) cfg.token = ch.token.newValue || "";
    if (ch.lastError) cfg.lastError = ch.lastError.newValue || "";
    paint();
    if (on) showBadge(); else badge.remove();
  });

  // data-id looks like "true_923001234567@c.us_3EB0XXXX" (true = I sent it) or "false_..._..." (donor sent it).
  function parse(id) {
    const m = /^(true|false)_(\\d+)@c\\.us_/.exec(id || "");
    if (!m) return null; // skip groups (@g.us) and anything odd
    return { id, phone: m[2], dir: m[1] === "true" ? "out" : "in", at: Date.now() };
  }
  function phoneOf(id) { const m = /^(?:true|false)_(\\d+)@c\\.us_/.exec(id || ""); return m ? m[1] : ""; }
  function remember(id) { seen.add(id); if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value); }
  function bubbles(root) {
    const nodes = [];
    if (root.matches && root.matches("[data-id]")) nodes.push(root);
    if (root.querySelectorAll) root.querySelectorAll("[data-id]").forEach((n) => nodes.push(n));
    return nodes;
  }

  // Every new message bubble under root (or root itself). Each id is remembered, so it is read once.
  function collect(root) {
    const out = [];
    for (const n of bubbles(root)) {
      const id = n.getAttribute("data-id");
      if (!id || seen.has(id)) continue;
      remember(id);
      const ev = parse(id);
      if (ev) out.push({ ev, node: n });
    }
    return out;
  }

  // Sends to the add-on. If it cannot be reached for a moment, try again a few times.
  function deliver(batch, tries) {
    if (!alive()) { dead = true; paint(); return; }
    let p;
    try { p = chrome.runtime.sendMessage({ type: "events", events: batch }); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).catch(() => {
      if (tries >= 4) { cfg.lastError = "cannot reach the add-on"; dead = !alive(); paint(); return; }
      setTimeout(() => deliver(batch, tries + 1), 3000);
    });
  }

  // Opening a chat loads old messages. That is history, not new DMs: remember it, never send it.
  // A real new message arrives alone (or 2-3 at most), so a bigger burst inside one short window is dropped too.
  let win = [];
  let winTimer = null;
  function push(events) {
    win.push(...events);
    if (winTimer) return;
    winTimer = setTimeout(() => {
      const batch = win;
      win = [];
      winTimer = null;
      if (on && batch.length <= HISTORY_BURST) deliver(batch, 0);
    }, 700);
  }

  let quietUntil = Date.now() + QUIET_AT_START;
  let removedAt = 0;
  let removedPhones = new Set();
  function noteRemoved(node) {
    const list = bubbles(node);
    if (!list.length) return;
    const now = Date.now();
    if (now - removedAt > SWAP_WINDOW) removedPhones = new Set();
    removedAt = now;
    for (const n of list) removedPhones.add(phoneOf(n.getAttribute("data-id")));
  }
  // A new message goes at the END of the chat. Older messages loaded by scrolling up go before the others.
  function atTheEnd(entries) {
    const all = document.querySelectorAll("[data-id]");
    const last = all[all.length - 1];
    return entries.some((x) => x.node === last || x.node.contains(last));
  }

  const obs = new MutationObserver((muts) => {
    showBadge(); // WhatsApp can redraw the page and wipe the badge: put it back
    if (!on) return;
    const entries = [];
    for (const mu of muts) if (mu.removedNodes) mu.removedNodes.forEach((node) => { if (node.nodeType === 1) noteRemoved(node); });
    for (const mu of muts) if (mu.addedNodes) mu.addedNodes.forEach((node) => { if (node.nodeType === 1) for (const x of collect(node)) entries.push(x); });
    if (!entries.length) return;
    const now = Date.now();
    const history =
      entries.length > HISTORY_BURST ||
      now < quietUntil ||
      !atTheEnd(entries) ||
      (now - removedAt < SWAP_WINDOW && entries.every((x) => !removedPhones.has(x.ev.phone)));
    if (history) { quietUntil = now + QUIET_AFTER_HISTORY; return; }
    push(entries.map((x) => x.ev));
  });
  obs.observe(document.body, { childList: true, subtree: true });
  // What is already on screen when the page opens is history too: remember it, do not send it.
  setTimeout(() => collect(document.body), 2500);
})();`;

const POPUP_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:14px system-ui;width:260px;margin:0;padding:14px;background:#0f1513;color:#e8eeeb}
h1{font-size:15px;margin:0 0 8px}label{display:block;font-size:12px;color:#9aa8a2;margin:8px 0 3px}
input,select{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #2a3531;background:#18201d;color:#e8eeeb}
button{width:100%;margin-top:10px;padding:9px;border:0;border-radius:8px;background:#1f8f72;color:#fff;font-weight:600;cursor:pointer}
.row{display:flex;gap:8px}.row button{margin-top:0}.off{background:#3a2418}
.s{font-size:12px;margin-top:10px;color:#9aa8a2}.ok{color:#55d1ac}.bad{color:#ff6b6b}
</style></head><body>
<h1>GiveLife Counter</h1>
<label>Pairing code (from the app)</label>
<input id="pair" placeholder="paste here"/>
<button id="save">Save & turn on</button>
<div class="row"><button id="on">On</button><button id="off" class="off">Off</button></div>
<div class="s" id="status"></div>
<script src="popup.js"></script></body></html>`;

const POPUP_JS = `// The pairing code is "APP_URL|role|token". Paste once; the add-on remembers it.
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function render() {
  chrome.storage.local.get(["app", "role", "on", "lastOkAt", "lastError", "lastCount", "unknownCount"], (s) => {
    const lines = [];
    lines.push(s.app ? ("App: " + esc(s.app)) : "Not paired yet.");
    if (s.app) lines.push("Mode: " + esc(s.role || "teammate") + " - " + (s.on === false ? "OFF" : "ON"));
    if (s.lastError) lines.push('<span class="bad">Problem: ' + esc(s.lastError) + "</span>");
    else if (s.lastOkAt) lines.push('<span class="ok">Working. Last sent ' + new Date(s.lastOkAt).toLocaleTimeString() + ".</span>");
    if (s.unknownCount > 0) lines.push('<span class="bad">' + esc(s.unknownCount) + " messages went to numbers that are not in the donor list, so they were not counted. Add the number in the app (Donors page).</span>");
    $("status").innerHTML = lines.join("<br>");
  });
}
$("save").onclick = () => {
  const parts = ($("pair").value || "").split("|");
  const role = (parts[1] || "").trim();
  const token = parts.slice(2).join("|").trim();
  let origin = "";
  try { origin = new URL((parts[0] || "").trim()).origin; } catch (e) { origin = ""; }
  if (!origin || (role !== "teammate" && role !== "manager") || token.length < 8) { $("status").textContent = "That code looks wrong."; return; }
  const allowed = (chrome.runtime.getManifest().host_permissions || []).some((h) => h === origin + "/*");
  if (!allowed) { $("status").textContent = "This code is for a different app address (" + origin + ") than the one this add-on came from. Download the add-on again from the app."; return; }
  chrome.storage.local.set({ app: origin, role, token, on: true, lastError: "", lastOkAt: 0, unknownCount: 0 }, render);
};
$("on").onclick = () => chrome.storage.local.set({ on: true }, render);
$("off").onclick = () => chrome.storage.local.set({ on: false }, render);
render();`;

const README = `GiveLife Counter — install steps

1. Unzip this folder.
2. Open Chrome and go to:  chrome://extensions
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and choose the unzipped folder.
5. Click the puzzle icon, open GiveLife Counter, and paste your pairing code.
6. Open https://web.whatsapp.com and log in. You will see a small green "GiveLife Counter ON" badge.
   Orange badge = not paired yet, or the last send had a problem. Open the add-on to see why.
   The first few seconds after WhatsApp opens count as loading: old chats are never counted.

It only COUNTS your donor DMs, and only donors whose phone number is in the app. It never sends anything and never reads your other chats.
To pause it, open the add-on and tap "Off", or remove it from chrome://extensions.`;

export function extensionFiles(appOrigin: string): { name: string; text: string }[] {
  const origin = appOrigin.replace(/\/$/, "");
  return [
    { name: "manifest.json", text: MANIFEST.replace("APP_ORIGIN", origin) },
    { name: "background.js", text: BACKGROUND },
    { name: "content.js", text: CONTENT },
    { name: "popup.html", text: POPUP_HTML },
    { name: "popup.js", text: POPUP_JS },
    { name: "README.txt", text: README },
  ];
}
