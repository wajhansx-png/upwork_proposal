const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

let db;
const pushes = [];
const fakeDb = { readDb: async () => structuredClone(db), withDb: async (fn) => fn(db), newId: () => crypto.randomUUID().slice(0, 8), kvGetImage: async () => null };
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  const from = parent?.filename ?? '';
  if (from.endsWith(path.join('lib', 'agent.ts'))) {
    if (request === './db') return fakeDb;
    if (request === './push') return { notify: async (...a) => pushes.push(a) };
  }
  if ((from.endsWith(path.join('lib', 'understand.ts')) || from.endsWith(path.join('lib', 'agent.ts')) || from.endsWith(path.join('lib', 'case.ts'))) && request === './llm') return { llm: async () => ({ text: null, status: 'off' }), parseJson: () => null };
  return load.call(this, request, parent, ...rest);
};
const C = require('../src/lib/counter.ts');
const { recordCounterEvents, setCounter } = require('../src/lib/agent.ts');
const { seedDonors } = require('../src/lib/donors.ts');
const { makeZip } = require('../src/lib/zip.ts');
const { extensionFiles } = require('../src/lib/extension-files.ts');

const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const freshDb = (tasks = []) => ({ settings: { teammateName: 'Areeba', timezone: 'Asia/Karachi', checkinMinutes: 5, workEndHour: 23 }, agent: { counter: { token: 'tok', on: true, seen: [] } }, donors: seedDonors(iso(now)), cases: [], messages: [], subs: [], hashes: {}, tasks });
const task = () => ({ id: 't1', title: 'Send 10 DMs', kind: 'dms', target: 10, status: 'open', createdAt: iso(now - 600000), deadlineAt: iso(now + 3600000), unanswered: 0, reportedDone: 0, startedAt: iso(now - 500000) });
const ev = (id, phone, dir = 'out', at = now) => ({ id, phone, dir, at });

(async () => {
  // 1. planCounter: phone match, first-contact only, dedupe, replies.
  const donors = seedDonors(iso(now));
  const withPhone = donors.find((d) => d.phone); // e.g. +923292186535
  const digits = withPhone.phone.slice(1);
  let plan = C.planCounter([ev('m1', digits), ev('m2', digits)], donors, []);
  assert.deepEqual(plan.sent, [withPhone.id], 'two messages to one new donor = one DM');
  assert.deepEqual(plan.seen, ['m1', 'm2']);
  plan = C.planCounter([ev('m1', digits)], donors, ['m1']);
  assert.equal(plan.sent.length, 0, 'a seen id never counts again');
  assert.equal(plan.duplicates, 1);
  plan = C.planCounter([ev('x', '999999999999')], donors, []);
  assert.equal(plan.unknown, 1, 'a number not on the list is unknown');
  assert.equal(plan.sent.length, 0);
  // reply only for a donor already sent
  const sent = { ...withPhone, status: 'sent' };
  const others = donors.map((d) => (d.id === withPhone.id ? sent : d));
  plan = C.planCounter([ev('r1', digits, 'in')], others, []);
  assert.deepEqual(plan.replied, [withPhone.id]);
  plan = C.planCounter([ev('r2', digits, 'in')], donors, []);
  assert.equal(plan.replied.length, 0, 'no reply mark for a donor never messaged');
  // group chat (no match) ignored by the add-on parser, but planCounter also ignores unknown
  assert.equal(C.matchDonor(donors, { phone: digits }).id, withPhone.id);
  assert.equal(C.matchDonor(donors, { name: 'Usman' })?.name, 'Usman');
  assert.equal(C.matchDonor(donors, { name: 'Ali' }), undefined, 'ambiguous/short name is not a guess');
  // seen cap
  const big = Array.from({ length: C.SEEN_CAP + 50 }, (_, i) => `id${i}`);
  plan = C.planCounter([], donors, big);
  assert.equal(plan.seen.length, C.SEEN_CAP);

  // 2. recordCounterEvents moves her task count, marks donors, alerts on replies.
  db = freshDb([task()]);
  const d1 = db.donors.find((d) => d.phone); const p1 = d1.phone.slice(1);
  const d2 = db.donors.filter((d) => d.phone)[1]; const p2 = d2.phone.slice(1);
  let r = await recordCounterEvents('tok', 'teammate', [ev('a', p1), ev('b', p2)]);
  assert.equal(r.ok, true);
  assert.equal(r.counted, 2);
  assert.equal(db.tasks[0].reportedDone, 2, 'two donor DMs add 2 to her task');
  assert.equal(db.donors.find((d) => d.id === d1.id).status, 'sent');
  // retry with same ids does not double count
  r = await recordCounterEvents('tok', 'teammate', [ev('a', p1), ev('b', p2)]);
  assert.equal(db.tasks[0].reportedDone, 2, 'a resend of the same events never double counts');
  // a reply alerts the manager
  r = await recordCounterEvents('tok', 'teammate', [ev('c', p1, 'in')]);
  assert.equal(r.replied, 1);
  assert.equal(db.donors.find((d) => d.id === d1.id).status, 'replied');
  assert.ok(db.messages.some((m) => m.owner === 'manager' && /Reply from/.test(m.text)));
  assert.ok(pushes.some((p) => p[0] === 'manager' && /replied/.test(p[1])));

  // 3. Off, or a wrong token, does nothing.
  db.agent.counter.on = false;
  r = await recordCounterEvents('tok', 'teammate', [ev('z', p2)]);
  assert.equal(r.ok, false);
  db.agent.counter.on = true;
  r = await recordCounterEvents('WRONG', 'teammate', [ev('z', p2)]);
  assert.equal(r.ok, false);
  assert.equal(db.donors.find((d) => d.id === d2.id).sends, 1, 'a wrong token changes nothing');

  // 4. Never counts past the task target.
  db = freshDb([{ ...task(), target: 2 }]);
  const phones = db.donors.filter((d) => d.phone).slice(0, 5);
  r = await recordCounterEvents('tok', 'teammate', phones.map((d, i) => ev('p' + i, d.phone.slice(1))));
  assert.equal(db.tasks[0].reportedDone, 2, 'count stops at the target');
  assert.equal(r.counted, 5, 'all 5 donors are still marked sent, only the task count caps');

  // 5. setCounter makes a token and flips the switch.
  db = freshDb();
  db.agent.counter = undefined;
  let sc = await setCounter('on');
  assert.ok(sc.token.startsWith('gc_') && sc.on);
  const first = sc.token;
  sc = await setCounter('off');
  assert.equal(sc.on, false);
  assert.equal(sc.token, first, 'turning off keeps the same token');
  sc = await setCounter('new');
  assert.notEqual(sc.token, first, 'new makes a fresh token');

  // 6. The add-on zip is a real zip with the right files, and the app origin is baked in.
  const files = extensionFiles('https://donor-agent-eta.vercel.app');
  assert.ok(files.find((f) => f.name === 'manifest.json').text.includes('https://donor-agent-eta.vercel.app/*'));
  assert.ok(!files.find((f) => f.name === 'content.js').text.match(/innerText|textContent.{0,20}message/i), 'add-on never reads message text');
  const zip = makeZip(files);
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'starts with a local file header');
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'ends with the end-of-central-directory record');
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), files.length, 'the zip lists every file');

  console.log('counter regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
