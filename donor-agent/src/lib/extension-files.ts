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
  "permissions": ["storage"],
  "host_permissions": ["https://web.whatsapp.com/*", "APP_ORIGIN/*"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{ "matches": ["https://web.whatsapp.com/*"], "js": ["content.js"], "run_at": "document_idle" }],
  "action": { "default_popup": "popup.html", "default_title": "GiveLife Counter" }
}`;

const BACKGROUND = `// Receives what the content script saw, batches it, and sends it to the GiveLife app.
let queue = [];
let timer = null;

async function cfg() {
  const s = await chrome.storage.local.get(["app", "token", "role", "on"]);
  return { app: s.app || "", token: s.token || "", role: s.role || "teammate", on: s.on !== false };
}

function later(ms) { if (!timer) timer = setTimeout(flush, ms); }

async function flush() {
  timer = null;
  const c = await cfg();
  if (!c.app || !c.token || !c.on || !queue.length) { if (!c.on) queue = []; return; }
  const events = queue.splice(0, 200);
  try {
    const res = await fetch(c.app.replace(/\\/$/, "") + "/api/counter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: c.token, from: c.role, events }),
    });
    const j = await res.json().catch(() => ({}));
    // Off or a wrong token: the app ignored them. Tell the person, and do not retry forever.
    if (!res.ok || j.ok === false) await chrome.storage.local.set({ lastError: (j && j.error) || ("off or wrong token (" + res.status + ")"), lastOkAt: 0 });
    else await chrome.storage.local.set({ lastError: "", lastOkAt: Date.now(), lastCount: (j.counted || 0) });
  } catch (e) {
    // No internet: keep them and try again. The app ignores repeats, so nothing is counted twice.
    queue = events.concat(queue).slice(-1000);
    await chrome.storage.local.set({ lastError: "no internet, will retry" });
    later(15000);
    return;
  }
  if (queue.length) later(1000);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "events" && Array.isArray(msg.events)) {
    queue.push(...msg.events);
    if (queue.length > 1000) queue = queue.slice(-1000);
    later(1500);
  }
});`;

const CONTENT = `// Watches the open WhatsApp chat and reports which donor DMs were sent or replied.
// It reads ONLY the "data-id" of each message bubble. It never reads message text.
(function () {
  const seen = new Set();
  let on = true;
  const badge = document.createElement("div");
  badge.textContent = "GiveLife Counter ON";
  badge.style.cssText = "position:fixed;z-index:99999;right:12px;bottom:12px;background:#1f8f72;color:#fff;font:600 12px system-ui;padding:6px 10px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.3);opacity:.9";
  function showBadge() { if (on && !badge.isConnected && document.body) document.body.appendChild(badge); }
  chrome.storage.local.get(["on"], (s) => { on = s.on !== false; showBadge(); });
  chrome.storage.onChanged.addListener((ch) => {
    if (!ch.on) return;
    on = ch.on.newValue !== false;
    if (on) showBadge(); else badge.remove();
  });

  // data-id looks like "true_923001234567@c.us_3EB0XXXX" (true = I sent it) or "false_..._..." (donor sent it).
  function parse(id) {
    const m = /^(true|false)_(\\d+)@c\\.us_/.exec(id || "");
    if (!m) return null; // skip groups (@g.us) and anything odd
    return { id, phone: m[2], dir: m[1] === "true" ? "out" : "in", at: Date.now() };
  }

  // Every new message bubble under root (or root itself). Each id is remembered, so it is read once.
  function collect(root) {
    const nodes = [];
    if (root.matches && root.matches("[data-id]")) nodes.push(root);
    if (root.querySelectorAll) root.querySelectorAll("[data-id]").forEach((n) => nodes.push(n));
    const out = [];
    for (const n of nodes) {
      const id = n.getAttribute("data-id");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const ev = parse(id);
      if (ev) out.push(ev);
    }
    return out;
  }

  // Opening a chat loads many old messages at once. That is history, not new DMs: remember it, never send it.
  // A real new message arrives alone (or 2-3 at most), so a bigger burst inside one short window is dropped.
  const HISTORY_BURST = 3;
  let win = [];
  let winTimer = null;
  function push(events) {
    if (!events.length) return;
    win.push(...events);
    if (winTimer) return;
    winTimer = setTimeout(() => {
      const batch = win;
      win = [];
      winTimer = null;
      if (on && batch.length <= HISTORY_BURST) chrome.runtime.sendMessage({ type: "events", events: batch });
    }, 700);
  }

  const obs = new MutationObserver((muts) => {
    if (!on) return;
    for (const mu of muts) mu.addedNodes && mu.addedNodes.forEach((node) => { if (node.nodeType === 1) push(collect(node)); });
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
function render() {
  chrome.storage.local.get(["app", "role", "on", "lastOkAt", "lastError", "lastCount"], (s) => {
    const lines = [];
    lines.push(s.app ? ("App: " + s.app) : "Not paired yet.");
    if (s.app) lines.push("Mode: " + (s.role || "teammate") + " — " + (s.on === false ? "OFF" : "ON"));
    if (s.lastError) lines.push('<span class="bad">Problem: ' + s.lastError + "</span>");
    else if (s.lastOkAt) lines.push('<span class="ok">Working. Last sent ' + new Date(s.lastOkAt).toLocaleTimeString() + ".</span>");
    $("status").innerHTML = lines.join("<br>");
  });
}
$("save").onclick = () => {
  const parts = ($("pair").value || "").split("|");
  if (parts.length < 3) { $("status").textContent = "That code looks wrong."; return; }
  chrome.storage.local.set({ app: parts[0].trim(), role: parts[1].trim(), token: parts.slice(2).join("|").trim(), on: true }, render);
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

It only COUNTS your donor DMs. It never sends anything and never reads your other chats.
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
