const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: 1, target: 9 } }).outputText, f);
const { extensionFiles } = require('../src/lib/extension-files.ts');
const { chromium } = require('playwright');
const APP = 'http://localhost:43118';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // 1. manager: log in, turn the counter on, make a task for Areeba
  const cookie = '';
  const mgr = (url, body) => fetch(APP + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-as': 'manager', cookie }, body: JSON.stringify(body) }).then((r) => r.json());
  const { token } = await mgr('/api/counter/pair', { action: 'on' });
  await mgr('/api/messages', { text: 'Areeba send 10 DMs by 11:30pm' });
  const her = async () => (await (await fetch(APP + '/api/state', { headers: { 'x-as': 'teammate' } })).json());
  const count = async () => (await her()).tasks.at(-1)?.reportedDone ?? 0;
  console.log('task count at start:', await count());

  // 2. install the REAL add-on (unpacked) into a real Chromium
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ext-'));
  for (const f of extensionFiles(APP)) fs.writeFileSync(path.join(dir, f.name), f.text);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-prof-')), {
    executablePath: '/opt/pw-browsers/chromium', headless: false,
    args: ['--headless=new', `--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--no-sandbox'],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  console.log('add-on loaded:', sw.url().startsWith('chrome-extension://'));
  // pair it, the same as pasting the code in the popup
  await sw.evaluate(([app, tok]) => chrome.storage.local.set({ app, token: tok, role: 'teammate', on: true }), [APP, token]);

  // 3. a fake WhatsApp Web page at the real address (so the real content script runs on it)
  const donor = (await (await fetch(APP + '/api/donors', { headers: { 'x-as': 'teammate' } })).json()).donors.filter((d) => d.phone);
  const [d1, d2] = [donor[0], donor[1]];
  await ctx.route('https://web.whatsapp.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="app"></div></body>' }));
  const wa = await ctx.newPage();
  await wa.goto('https://web.whatsapp.com/');
  await sleep(3500);
  console.log('badge on the page:', await wa.locator('text=GiveLife Counter ON').count());
  const add = (id) => wa.evaluate((i) => { const el = document.createElement('div'); el.setAttribute('data-id', i); el.innerHTML = '<span>private text</span>'; document.getElementById('app').appendChild(el); }, id);

  // 4. Areeba's real screen is open and refreshing
  const herPage = await ctx.newPage();
  await herPage.goto(APP + '/areeba');
  await herPage.waitForSelector('.counter');
  const shown = async () => (await herPage.locator('.counter .ring-num').innerText()).trim();
  console.log('her screen shows:', await shown());

  // 5. she "sends" a DM to donor 1 in WhatsApp Web. Measure how long until her screen moves.
  const t0 = Date.now();
  await add(`true_${d1.phone.slice(1)}@c.us_E2E_1`);
  let sawServer = 0, sawScreen = 0;
  while (Date.now() - t0 < 20000 && !(sawServer && sawScreen)) {
    if (!sawServer && (await count()) === 1) sawServer = Date.now() - t0;
    if (!sawScreen && (await shown()) === '1') sawScreen = Date.now() - t0;
    await sleep(250);
  }
  console.log(`DM 1 -> server count 1 after ${sawServer}ms, her screen shows 1 after ${sawScreen}ms`);

  // 6. second DM, another donor
  const t1 = Date.now();
  await add(`true_${d2.phone.slice(1)}@c.us_E2E_2`);
  while (Date.now() - t1 < 20000 && (await count()) !== 2) await sleep(250);
  console.log('DM 2 -> server count:', await count());

  // 7. a donor replies: manager must get a reply note, donor becomes "replied"
  await add(`false_${d1.phone.slice(1)}@c.us_E2E_R1`);
  await sleep(4000);
  const mstate = await (await fetch(APP + '/api/state', { headers: { 'x-as': 'manager', cookie } })).json();
  console.log('manager got reply note:', mstate.messages.some((m) => /Reply from/.test(m.text)));
  const list = await (await fetch(APP + '/api/donors', { headers: { 'x-as': 'teammate' } })).json();
  console.log('donor 1 status:', list.donors.find((x) => x.id === d1.id).status, '| donor 2 status:', list.donors.find((x) => x.id === d2.id).status);

  // 8. repeat + off
  await add(`true_${d1.phone.slice(1)}@c.us_E2E_1`);
  await sleep(3000);
  console.log('same message again -> count still:', await count());
  await mgr('/api/counter/pair', { action: 'off' });
  const donor3 = donor[2];
  await add(`true_${donor3.phone.slice(1)}@c.us_E2E_3`);
  await sleep(4000);
  console.log('manager switch OFF, new DM -> count still:', await count());
  console.log('final add-on status:', JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(['lastError', 'lastOkAt']))));
  await ctx.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
