// Runs the REAL add-on code (content.js in a browser, background.js in node) against a fake WhatsApp-like page.
// Needs Chromium (Playwright). Not part of `npm test`: run with  NODE_PATH=$(npm root -g) node scripts/extension-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { extensionFiles } = require('../src/lib/extension-files.ts');
const { chromium } = require('playwright');

const files = Object.fromEntries(extensionFiles('https://app.test').map((f) => [f.name, f.text]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function contentScript() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const stub = () => {
    window.__sent = [];
    window.__on = true;
    window.__listeners = [];
    window.chrome = {
      storage: { local: { get: (_k, cb) => cb({ on: window.__on }) }, onChanged: { addListener: (fn) => window.__listeners.push(fn) } },
      runtime: { sendMessage: (m) => window.__sent.push(m) },
    };
  };
  // 5 old messages already on screen when the page opens.
  await page.setContent(`<body><div id="app">${[1, 2, 3, 4, 5].map((i) => `<div data-id="true_923001230000@c.us_OLD${i}"><span>old private text ${i}</span></div>`).join('')}</div></body>`);
  await page.evaluate(stub);
  await page.addScriptTag({ content: files['content.js'] });
  const sent = () => page.evaluate(() => window.__sent.flatMap((m) => m.events));
  const add = (html) => page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = h; for (const n of [...d.children]) document.getElementById('app').appendChild(n); }, html);
  const bubble = (id, text = 'SECRET MESSAGE TEXT') => `<div data-id="${id}"><span>${text}</span></div>`;

  assert.equal(await page.locator('text=GiveLife Counter ON').count(), 1, 'the visible badge shows');
  await sleep(3400);
  assert.equal((await sent()).length, 0, 'what is on screen at load is history: nothing is sent');

  await add(bubble('true_923001234567@c.us_NEW1'));
  await sleep(1200);
  let ev = await sent();
  assert.equal(ev.length, 1, 'a new single DM is sent');
  assert.deepEqual(Object.keys(ev[0]).sort(), ['at', 'dir', 'id', 'phone'], 'only id, number, direction and time — never text');
  assert.equal(ev[0].phone, '923001234567');
  assert.equal(ev[0].dir, 'out');
  assert.ok(!JSON.stringify(await page.evaluate(() => window.__sent)).includes('SECRET'), 'message text never leaves the page');

  await add(bubble('false_923001234567@c.us_REPLY1'));
  await sleep(1200);
  ev = await sent();
  assert.equal(ev.at(-1).dir, 'in', 'a reply is sent as "in"');

  await add(bubble('true_923001234567@c.us_NEW1'));
  await sleep(1200);
  assert.equal((await sent()).length, 2, 'the same message id is never sent twice');

  await add(bubble('true_120363000000000000@g.us_GROUP1'));
  await sleep(1200);
  assert.equal((await sent()).length, 2, 'group chats are ignored');

  await add([1, 2, 3, 4, 5, 6].map((i) => bubble(`true_923009999999@c.us_BURST${i}`)).join(''));
  await sleep(1200);
  assert.equal((await sent()).length, 2, 'opening a chat (a burst of old messages) is history: nothing is sent');

  await add(bubble('true_923001112222@c.us_AFTER1'));
  await sleep(1200);
  assert.equal((await sent()).length, 3, 'a new DM right after a burst still counts');

  // Off: badge goes, nothing is sent.
  await page.evaluate(() => { window.__on = false; window.__listeners.forEach((fn) => fn({ on: { newValue: false } })); });
  await sleep(100);
  assert.equal(await page.locator('text=GiveLife Counter ON').count(), 0, 'the badge goes when it is off');
  await add(bubble('true_923005550000@c.us_OFF1'));
  await sleep(1200);
  assert.equal((await sent()).length, 3, 'off means nothing is sent');
  await page.evaluate(() => window.__listeners.forEach((fn) => fn({ on: { newValue: true } })));
  await sleep(100);
  assert.equal(await page.locator('text=GiveLife Counter ON').count(), 1, 'the badge returns when it is on');
  await browser.close();
}

async function background() {
  const store = { app: 'https://app.test/', token: 'tok', role: 'teammate', on: true };
  const calls = [];
  let mode = 'ok';
  let listener;
  const sandbox = {
    chrome: {
      storage: { local: { get: async (keys) => Object.fromEntries(keys.map((k) => [k, store[k]])), set: async (o) => Object.assign(store, o) } },
      runtime: { onMessage: { addListener: (fn) => (listener = fn) } },
    },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (mode === 'down') throw new Error('offline');
      if (mode === 'off') return { ok: false, status: 403, json: async () => ({ ok: false }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, counted: 1 }) };
    },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)), // shrink waits
    Date, console,
  };
  vm.runInNewContext(files['background.js'], sandbox);
  const ev = (id) => ({ id, phone: '923001234567', dir: 'out', at: 1 });

  listener({ type: 'events', events: [ev('a'), ev('b')] });
  await sleep(300);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://app.test/api/counter', 'one slash, the right address');
  assert.deepEqual(calls[0].body.events.map((e) => e.id), ['a', 'b']);
  assert.equal(calls[0].body.token, 'tok');
  assert.equal(calls[0].body.from, 'teammate');
  assert.equal(store.lastError, '');

  mode = 'down';
  listener({ type: 'events', events: [ev('c')] });
  await sleep(300);
  assert.ok(calls.length >= 3, 'no internet: it keeps the events and retries');
  mode = 'ok';
  await sleep(300);
  assert.equal(calls.at(-1).body.events[0].id, 'c', 'the retry sends the same event');
  assert.equal(store.lastError, '');

  mode = 'off';
  const n = calls.length;
  listener({ type: 'events', events: [ev('d')] });
  await sleep(300);
  assert.equal(calls.length, n + 1, 'off or a wrong token: tried once, not forever');
  assert.match(store.lastError, /off or wrong token/);

  store.on = false;
  const m = calls.length;
  listener({ type: 'events', events: [ev('e')] });
  await sleep(300);
  assert.equal(calls.length, m, 'switched off in the add-on: nothing is sent');
  listener({ type: 'junk' });
  listener(null);
}

(async () => {
  await contentScript();
  await background();
  console.log('extension check: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
