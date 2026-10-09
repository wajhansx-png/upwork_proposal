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
  if ((from.endsWith(path.join('lib', 'understand.ts')) || from.endsWith(path.join('lib', 'agent.ts'))) && request === './llm') return { llm: async () => ({ text: null, status: 'off' }), parseJson: () => null };
  return load.call(this, request, parent, ...rest);
};
const D = require('../src/lib/donors.ts');
const { markDonor, saveDonor, handleTeammateMessage } = require('../src/lib/agent.ts');

const DAY = 864e5;
const now = Date.now();
const iso = (t) => new Date(t).toISOString();

(async () => {
  // 1. The list: all 138, 33 with WhatsApp numbers, fixed ids, sensible groups.
  const seed = D.seedDonors(iso(now));
  assert.equal(seed.length, 138);
  assert.equal(seed.filter((d) => d.phone).length, 33);
  assert.deepEqual(seed.map((d) => d.id), D.seedDonors().map((d) => d.id), 'ids must be the same on every load');
  assert.equal(new Set(seed.map((d) => d.id)).size, 138);
  const g = (name) => seed.find((d) => d.name === name).group;
  assert.equal(g('UET Lahore 7'), 'UET Lahore');
  assert.equal(g('Upwork Member 40'), 'Upwork');
  assert.equal(g('D12'), 'D list');
  assert.equal(g('Syed Ahsan D15'), 'D list');
  assert.equal(g('Usman'), 'WhatsApp');
  assert.equal(g('Abdul Basit'), 'Others');
  assert.ok(seed.every((d) => !d.phone || /^\+\d{10,15}$/.test(d.phone)));
  assert.equal(seed.filter((d) => !d.name).length, 24, 'unnamed numbers (21 + 3 "Contact") keep only the phone');

  // 2. Greetings use real names only.
  const gn = (name, phone) => D.greetName({ name, phone, group: D.groupOf(name, phone) });
  assert.equal(gn('Abdul Basit'), 'Abdul Basit');
  assert.equal(gn('M Adil'), 'Adil');
  assert.equal(gn('Kh. Awais 4.5k'), 'Awais');
  assert.equal(gn('D12'), '');
  assert.equal(gn('UET Lahore 7'), '');
  assert.equal(gn('Jr Accounts'), '');
  assert.equal(gn('Saqlain Khan (Fiverr)', '+923079913095'), 'Saqlain');
  assert.match(D.draftMessage(seed[0], 'new', 'Areeba'), /^Assalam o Alaikum! This is Areeba/);

  // 3. Who to message first: replied > gave long ago > reminder > new with phone > new.
  const mk = (o) => ({ id: o.id, name: o.name ?? o.id, phone: o.phone, group: 'Others', status: 'new', sends: 0, updatedAt: iso(now), ...o });
  const list = [
    mk({ id: 'new' }),
    mk({ id: 'newPhone', phone: '+923001112223', group: 'WhatsApp' }),
    mk({ id: 'remind', status: 'sent', sends: 1, sentAt: iso(now - 4 * DAY) }),
    mk({ id: 'tooSoon', status: 'sent', sends: 1, sentAt: iso(now - 1 * DAY) }),
    mk({ id: 'tired', status: 'sent', sends: 3, sentAt: iso(now - 9 * DAY) }),
    mk({ id: 'gaveOld', status: 'donated', donatedAt: iso(now - 40 * DAY), amount: 5000 }),
    mk({ id: 'gaveNew', status: 'donated', donatedAt: iso(now - 2 * DAY) }),
    mk({ id: 'replied', status: 'replied', sends: 1, repliedAt: iso(now) }),
    mk({ id: 'no', status: 'no' }),
  ];
  assert.deepEqual(D.todayPicks(list, now, 20).map((p) => p.id), ['replied', 'gaveOld', 'remind', 'newPhone', 'new']);
  assert.deepEqual(D.todayPicks(list, now, 2).map((p) => p.id), ['replied', 'gaveOld']);
  assert.deepEqual(D.todayPicks(list, now, -3), []);

  // 4. Marks and undo.
  const d = mk({ id: 'x' });
  assert.equal(D.applyDonorAction(d, 'sent', iso(now), { counts: true }), 1);
  assert.equal(d.status, 'sent');
  assert.equal(d.sends, 1);
  assert.equal(D.applyDonorAction(d, 'undo', iso(now)), -1);
  assert.equal(d.status, 'new');
  assert.equal(d.sends, 0);
  assert.equal(D.applyDonorAction(d, 'undo', iso(now)), 0, 'a second undo does nothing');
  D.applyDonorAction(d, 'donated', iso(now), { amount: 2500 });
  D.applyDonorAction(d, 'donated', iso(now), { amount: -5 });
  D.applyDonorAction(d, 'donated', iso(now), { amount: NaN });
  assert.equal(d.amount, 2500, 'bad amounts are ignored');
  assert.equal(D.applyDonorAction(d, 'sent', iso(now), { counts: false }), 0);

  // 5. Old saved donors still load.
  const old = D.normalizeDonor({ id: 'o1', name: 'Old', channel: 'whatsapp', contact: '0300 1234567', status: 'todo', flags: [] }, 0);
  assert.equal(old.status, 'new');
  assert.equal(old.phone, '+923001234567', 'Pakistani local numbers get +92');
  assert.equal(D.cleanPhone('+92 300-1234567'), '+923001234567');
  assert.equal(D.cleanPhone('abc'), undefined);
  assert.equal(D.normalizeDonor({ status: 'skipped' }, 3).status, 'no');
  assert.equal(D.normalizeDonor({ status: 'weird', amount: -9 }, 4).amount, undefined);

  // 6. Ideas are true to the numbers.
  const ideas = D.ruleIdeas(seed, now);
  assert.ok(ideas.some((t) => t.startsWith('33 donors have a WhatsApp number')));
  assert.ok(ideas.some((t) => t.startsWith('105 donors have no phone')));
  assert.ok(ideas.some((t) => /No gifts are marked yet/.test(t)));
  assert.ok(ideas.length <= 5);

  // 7. Her "Sent" moves her task by 1; undo takes it back; manager marks never count; a gift alerts him.
  const task = { id: 't1', title: 'Send 10 DMs', kind: 'dms', target: 10, status: 'open', createdAt: iso(now - 600000), deadlineAt: iso(now + 3600000), unanswered: 0, reportedDone: 2, startedAt: iso(now - 500000) };
  db = { settings: { teammateName: 'Areeba', timezone: 'Asia/Karachi', checkinMinutes: 5, workEndHour: 23 }, agent: {}, donors: D.seedDonors(iso(now)), messages: [], subs: [], hashes: {}, tasks: [task] };
  await markDonor('teammate', 'd2', 'sent');
  assert.equal(db.tasks[0].reportedDone, 3);
  await markDonor('teammate', 'd2', 'undo');
  assert.equal(db.tasks[0].reportedDone, 2);
  await markDonor('manager', 'd3', 'sent');
  assert.equal(db.tasks[0].reportedDone, 2, 'manager marks do not change her count');
  await markDonor('teammate', 'd4', 'donated', { amount: 3000 });
  assert.ok(db.messages.some((m) => m.owner === 'manager' && /Abdul Moeed gave Rs 3,000 \(marked by Areeba\)/.test(m.text)));
  assert.ok(pushes.some((p) => p[0] === 'manager' && p[1] === 'New gift'));
  await assert.rejects(markDonor('teammate', 'nope', 'sent'), /not in the list/);
  db.tasks[0].status = 'done';
  await markDonor('teammate', 'd5', 'sent');
  assert.equal(db.donors.find((x) => x.id === 'd5').status, 'sent', 'works with no open task');

  // 8. Manager edits.
  await saveDonor({ id: 'd2', phone: '0092 300 7654321' });
  assert.equal(db.donors.find((x) => x.id === 'd2').phone, '+923007654321');
  await assert.rejects(saveDonor({ id: 'd2', phone: '12' }), /does not look right/);
  await assert.rejects(saveDonor({ name: '  ' }), /Write a name/);
  await assert.rejects(saveDonor({ name: 'Dup', phone: '+923414757829' }), /already in the list/);
  const added = await saveDonor({ name: 'New Person', phone: '+923001231234' });
  assert.equal(added.group, 'WhatsApp');
  assert.equal(db.donors.length, 139);

  // 9. "Which donors should I message?" is answered from the list, not sent to the manager.
  db.tasks[0].status = 'open';
  db.tasks[0].brief = undefined;
  db.messages = [];
  await handleTeammateMessage('which donors should I message?', null);
  const reply = db.messages.filter((m) => m.owner === 'teammate' && m.from === 'agent').pop();
  assert.match(reply.text, /Open “Donors” at the top\. Start with: /);
  assert.equal(db.tasks[0].pendingAsk, undefined, 'no question waits on the manager');

  console.log('donors regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
