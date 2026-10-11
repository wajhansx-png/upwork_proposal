// Runs the REAL add-on code (content.js in a browser, background.js in node) against a fake WhatsApp-like page.
// Needs Chromium (Playwright). Not part of `npm test`: run with  NODE_PATH=$(npm root -g) node scripts/extension-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { extensionFiles } = require(process.env.EXT || '../src/lib/extension-files.ts');
const { chromium } = require('playwright');

const files = Object.fromEntries(extensionFiles('https://app.test').map((f) => [f.name, f.text]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function contentScript() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const stub = () => {
    window.__sent = [];
    window.__on = true;
    window.__fail = false;
    window.__store = { on: true, app: 'https://app.test', token: 'tok' };
    window.__listeners = [];
    window.chrome = {
      storage: { local: { get: (_k, cb) => cb({ ...window.__store, on: window.__on }) }, onChanged: { addListener: (fn) => window.__listeners.push(fn) } },
      runtime: { id: 'x', sendMessage: (m) => { if (window.__fail) return Promise.reject(new Error('down')); window.__sent.push(m); return Promise.resolve({ ok: true }); } },
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
  await sleep(8600); // WhatsApp's first seconds count as loading
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

  await sleep(2500); // she needs a few seconds to write a DM after opening a chat
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


// A page that starts empty; helpers shared by the history tests.
async function freshPage(browser, store) {
  const page = await browser.newPage();
  await page.setContent('<body><div id="app"></div></body>');
  await page.evaluate((st) => {
    window.__sent = []; window.__on = true; window.__fail = false; window.__listeners = [];
    window.__store = st;
    window.chrome = {
      storage: { local: { get: (_k, cb) => cb({ ...window.__store, on: window.__on }) }, onChanged: { addListener: (fn) => window.__listeners.push(fn) } },
      runtime: { id: 'x', sendMessage: (m) => { if (window.__fail) return Promise.reject(new Error('down')); window.__sent.push(m); return Promise.resolve({ ok: true }); } },
    };
  }, store);
  await page.addScriptTag({ content: files['content.js'] });
  return {
    page,
    sent: () => page.evaluate(() => window.__sent.flatMap((m) => m.events)),
    add: (ids) => page.evaluate((list) => { for (const id of list) { const d = document.createElement('div'); d.setAttribute('data-id', id); d.innerHTML = '<span>SECRET</span>'; document.getElementById('app').appendChild(d); } }, ids),
    prepend: (ids) => page.evaluate((list) => { const a = document.getElementById('app'); for (const id of list.reverse()) { const d = document.createElement('div'); d.setAttribute('data-id', id); d.innerHTML = '<span>SECRET</span>'; a.insertBefore(d, a.firstChild); } }, ids),
    clear: () => page.evaluate(() => { document.getElementById('app').innerHTML = ''; }),
    drop: (n) => page.evaluate((k) => { const a = document.getElementById('app'); for (let i = 0; i < k; i++) a.firstChild && a.firstChild.remove(); }, n),
  };
}
const ids = (phone, tag, n, dir = 'true') => Array.from({ length: n }, (_, i) => `${dir}_${phone}@c.us_${tag}${i}`);

async function historyRules() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const t = await freshPage(browser, { on: true, app: 'https://app.test', token: 'tok' });

  // WhatsApp loads slowly: a small old chat can appear a second or two after the script starts.
  await sleep(1000);
  await t.add(ids('923001110001', 'LATE', 2));
  await sleep(1500);
  assert.equal((await t.sent()).length, 0, 'a small old chat that loads late is history');

  await sleep(8500); // quiet time after load is over
  // She opens another chat that holds only 2 old messages: the old chat's messages go, the new chat's come.
  await t.clear();
  await t.add(ids('923001110002', 'SMALL', 2));
  await sleep(1500);
  assert.equal((await t.sent()).length, 0, 'opening a small chat (2 old messages) is history, not new DMs');

  // WhatsApp loads old messages in pieces, 3 then 3 more.
  await sleep(3000);
  await t.clear();
  await t.add(ids('923001110003', 'CH1', 3));
  await sleep(1000);
  await t.add(ids('923001110003', 'CH2', 3));
  await sleep(1500);
  assert.equal((await t.sent()).length, 0, 'old messages that load in pieces are history');

  // She opens an EMPTY chat and sends the first DM a few seconds later: this one counts.
  await sleep(3000);
  await t.clear();
  await sleep(3000);
  await t.add(['true_923001110004@c.us_REAL1']);
  await sleep(1200);
  let ev = await t.sent();
  assert.deepEqual(ev.map((e) => e.id), ['true_923001110004@c.us_REAL1'], 'the first DM in a fresh empty chat counts');

  // A long chat drops old bubbles from the page while she sends: the send still counts.
  await t.drop(1);
  await t.add(['true_923001110004@c.us_REAL2']);
  await sleep(1200);
  ev = await t.sent();
  assert.ok(ev.some((e) => e.id === 'true_923001110004@c.us_REAL2'), 'a send in the same chat still counts when the page trims old bubbles');

  // Scrolling up in the same chat loads old bubbles: they must not count.
  const before = (await t.sent()).length;
  await sleep(3000);
  await t.prepend(ids('923001110004', 'SCROLL', 2));
  await sleep(1500);
  assert.equal((await t.sent()).length, before, 'old bubbles that load when she scrolls up are history');
  await browser.close();
}

async function badgeAndRetry() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  // Not paired: the badge must NOT say ON.
  let t = await freshPage(browser, { on: true });
  assert.equal(await t.page.locator('text=GiveLife Counter ON').count(), 0, 'not paired: the badge does not say ON');
  assert.equal(await t.page.locator('text=not paired').count(), 1, 'not paired: the badge says so');
  // Pairing makes it ON; a send problem shows on the badge too.
  await t.page.evaluate(() => window.__listeners.forEach((fn) => fn({ app: { newValue: 'https://app.test' }, token: { newValue: 't' } })));
  await sleep(100);
  assert.equal(await t.page.locator('text=GiveLife Counter ON').count(), 1, 'paired: the badge says ON');
  await t.page.evaluate(() => window.__listeners.forEach((fn) => fn({ lastError: { newValue: 'off or wrong token (403)' } })));
  await sleep(100);
  assert.equal(await t.page.locator('text=GiveLife Counter ON').count(), 0, 'a problem is shown on the badge');
  assert.equal(await t.page.locator('text=problem').count(), 1);
  await t.page.close();

  // The page can delete the badge (WhatsApp re-renders): it comes back.
  t = await freshPage(browser, { on: true, app: 'https://app.test', token: 'tok' });
  await t.page.evaluate(() => document.querySelectorAll('div').forEach((d) => d.textContent.startsWith('GiveLife') && d.remove()));
  await sleep(200);
  assert.equal(await t.page.locator('text=GiveLife Counter ON').count(), 1, 'the badge comes back if the page removes it');

  // If the add-on cannot be reached for a moment, the DM is sent again, not lost.
  await sleep(8500);
  await t.page.evaluate(() => { window.__fail = true; });
  await t.add(['true_923007770001@c.us_RETRY1']);
  await sleep(1500);
  assert.equal((await t.sent()).length, 0, 'the add-on was unreachable');
  await t.page.evaluate(() => { window.__fail = false; });
  await sleep(6000);
  assert.deepEqual((await t.sent()).map((e) => e.id), ['true_923007770001@c.us_RETRY1'], 'the DM is sent again once the add-on answers');
  await browser.close();
}

async function popup() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.setContent(files['popup.html'].replace('<script src="popup.js"></script>', ''));
  await page.evaluate(() => {
    window.__store = { lastError: '<img src=x id=pwn onerror="window.__pwn=1">', app: 'https://app.test' };
    window.chrome = {
      storage: { local: { get: (_k, cb) => cb({ ...window.__store }), set: (o, cb) => { Object.assign(window.__store, o); cb && cb(); } } },
      runtime: { getManifest: () => ({ host_permissions: ['https://web.whatsapp.com/*', 'https://app.test/*'] }) },
    };
  });
  await page.addScriptTag({ content: files['popup.js'] });
  await sleep(200);
  assert.equal(await page.locator('#pwn').count(), 0, 'an error text from the server is shown as plain text, never as page code');
  assert.equal(await page.evaluate(() => window.__pwn), undefined);
  const say = async (code) => { await page.fill('#pair', code); await page.click('#save'); await sleep(100); return page.evaluate(() => ({ s: document.getElementById('status').innerText, st: window.__store })); };
  let r = await say('nonsense');
  assert.match(r.s, /looks wrong/i);
  r = await say('https://app.test|boss|gc_abcdefghijklmnop');
  assert.match(r.s, /looks wrong/i, 'an unknown role is refused');
  r = await say('https://other.test|teammate|gc_abcdefghijklmnop');
  assert.match(r.s, /different app address/i, 'a code for another address is refused with a clear reason');
  assert.equal(r.st.token, undefined, 'a refused code is not saved');
  r = await say('https://app.test/|teammate|gc_abcdefghijklmnop');
  assert.equal(r.st.token, 'gc_abcdefghijklmnop');
  assert.equal(r.st.app, 'https://app.test', 'the saved address has no trailing slash');
  assert.equal(r.st.lastError, '', 'a fresh pairing clears the old problem');
  await page.evaluate(() => { window.__store.unknownCount = 4; });
  await page.evaluate(() => document.getElementById('on').click());
  await sleep(100);
  assert.match(await page.evaluate(() => document.getElementById('status').innerText), /4 .*not in the donor list/i, 'it tells her about DMs that could not be matched');
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
      if (mode === 'busy') return { ok: false, status: 503, json: async () => { throw new Error('html'); } };
      return { ok: true, status: 200, json: async () => ({ ok: true, counted: 1, unknown: mode === 'unk' ? 2 : 0 }) };
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


  // Messages the app could not match to a donor are tallied, so the popup can tell her.
  mode = 'unk';
  listener({ type: 'events', events: [ev('u1')] });
  await sleep(300);
  listener({ type: 'events', events: [ev('u2')] });
  await sleep(300);
  assert.equal(store.unknownCount, 4, 'unmatched messages add up');
  mode = 'ok';

  // A busy or broken server (5xx, 429) is NOT "off": keep the events and try again.
  mode = 'busy';
  const k = calls.length;
  listener({ type: 'events', events: [ev('f')] });
  await sleep(300);
  assert.ok(calls.length >= k + 2, 'a 503 from the app: it retries');
  mode = 'ok';
  await sleep(300);
  assert.equal(calls.at(-1).body.events[0].id, 'f', 'the DM is delivered once the app is back');
  assert.equal(store.lastError, '');

  store.on = false;
  const m = calls.length;
  listener({ type: 'events', events: [ev('e')] });
  await sleep(300);
  assert.equal(calls.length, m, 'switched off in the add-on: nothing is sent');
  listener({ type: 'junk' });
  listener(null);
}


// Chrome shuts the add-on's background worker down when idle. Events waiting to be sent must survive that.
async function workerDeath() {
  const store = { app: 'https://app.test', token: 'tok', role: 'teammate', on: true };
  const calls = [];
  const make = (isDown) => {
    let dead = false;
    let listener;
    const sandbox = {
      chrome: {
        storage: {
          local: {
            get: async (keys) => (dead ? {} : Object.fromEntries(keys.map((k) => [k, store[k]]))),
            set: async (o) => { if (!dead) Object.assign(store, o); },
          },
          onChanged: { addListener: () => undefined },
        },
        runtime: { onMessage: { addListener: (fn) => (listener = fn) } },
      },
      fetch: async (url, init) => {
        if (dead) throw new Error('worker is gone');
        if (isDown()) throw new Error('offline');
        calls.push(JSON.parse(init.body).events.map((e) => e.id));
        return { ok: true, status: 200, json: async () => ({ ok: true, counted: 1 }) };
      },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)),
      Date, console,
    };
    vm.runInNewContext(files['background.js'], sandbox);
    return { send: (events) => listener({ type: 'events', events }), kill: () => { dead = true; } };
  };
  let down = true;
  const w1 = make(() => down);
  w1.send([{ id: 'p1', phone: '923001234567', dir: 'out', at: 1 }, { id: 'p2', phone: '923001234567', dir: 'out', at: 2 }]);
  await sleep(150);
  w1.kill(); // Chrome stops the worker while the internet is still down
  down = false;
  make(() => down); // the worker starts again later
  await sleep(400);
  assert.deepEqual(calls.flat(), ['p1', 'p2'], 'DMs waiting to be sent survive the worker being stopped, and are sent once');
}

(async () => {
  const only = process.env.ONLY;
  const steps = { contentScript, historyRules, badgeAndRetry, popup, background, workerDeath };
  for (const [name, fn] of Object.entries(steps)) if (!only || only === name) await fn();
  console.log('extension check: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
