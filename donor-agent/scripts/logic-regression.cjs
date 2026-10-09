const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const db = { settings: { teammateName: 'Areeba', timezone: 'Asia/Karachi', checkinMinutes: 5, workEndHour: 23, dailyTarget: 20 }, agent: {}, tasks: [], donors: [], messages: [], subs: [], hashes: {} };
const pushes = [];
const load = Module._load;
Module._load = function (r, p, ...x) {
  const f = p?.filename ?? '';
  if (f.endsWith(path.join('lib', 'agent.ts'))) {
    if (r === './db') return { readDb: async () => structuredClone(db), withDb: async (fn) => fn(db), newId: () => Math.random().toString(36).slice(2, 8), kvGetImage: async () => null };
    if (r === './push') return { notify: async (...a) => pushes.push(a) };
    if (r === './vision') return { readScreenshot: async () => ({ seen: null }), checkProof: async () => null };
  }
  // No AI: the rules alone must give good answers (this is what runs when GPT fails).
  if (f.endsWith('understand.ts') && r === './llm') return { llm: async () => ({ text: null, status: 'off' }), parseJson: () => null };
  return load.call(this, r, p, ...x);
};
const A = require('../src/lib/agent.ts');
const task = () => db.tasks.at(-1);
const toHer = async (m) => { const n = db.messages.length; await A.handleTeammateMessage(m); return db.messages.slice(n).filter((x) => x.owner === 'teammate' && x.from === 'agent').map((x) => x.text).join('\n'); };
const toMgr = async (m) => { const n = db.messages.length; await A.handleManagerMessage(m); return { me: db.messages.slice(n).filter((x) => x.owner === 'manager' && x.from === 'agent').map((x) => x.text).join('\n'), her: db.messages.slice(n).filter((x) => x.owner === 'teammate').map((x) => x.text).join('\n') }; };

(async () => {
  await toMgr('Areeba send 100 DMs by 11:59pm');
  // Her questions are answered from facts, not passed on.
  assert.match(await toHer('hi'), /Hi Areeba!.*\n.*start now/s);
  assert.match(await toHer('ok'), /start now/, 'an ok before starting is pushed to start');
  await toHer('I started');
  assert.match(await toHer('how many do I have to send?'), /Your task: Send 100 DMs/);
  assert.match(await toHer('what is my count?'), /0 of 100 done, 100 to go/);
  assert.match(await toHer('kitne hogaye?'), /of 100 done/);
  assert.match(await toHer('who are you?'), /I am Wajdan/);
  assert.match(await toHer('when is the deadline?'), /Your deadline is/);
  // Counts in many forms.
  await toHer('40'); assert.equal(task().reportedDone, 40, 'a bare number is her count');
  await toHer('main ne 50 bhej diye'); assert.equal(task().reportedDone, 50, 'Roman Urdu count');
  await toHer('done 5 more'); assert.equal(task().reportedDone, 55);
  await toHer('I will send 10 more after lunch'); assert.equal(task().reportedDone, 55, 'a plan is not progress');
  // Pushback and honesty.
  assert.match(await toHer('I will do it later'), /Send just 1 DM now.*45 are still left/s);
  assert.match(db.messages.filter((m) => m.owner === 'manager').at(-1).text, /putting it off/);
  assert.match(await toHer('kal karungi'), /Send just 1 DM now/);
  assert.match(await toHer('I cannot do 100 today'), /honest/);
  assert.equal(task().blockedReason, undefined, 'cannot finish is not a broken phone');
  assert.match(await toHer('I am tired'), /just \d+ more DMs?, then take 5 minutes/);
  assert.match(await toHer('my mind is fucking'), /Let's make it small/, 'swearing is stress, answered with a tiny step');
  await toHer('my internet is not working'); assert.ok(task().blockedReason);
  await toHer('60'); assert.equal(task().blockedReason, undefined, 'reporting progress clears the blocker');

  // Goals: every report sets a small next goal; reaching it is praised; missing it gets a specific push.
  assert.match(await toHer('62'), /Next goal: reach \d+ by/);
  const g = task().goal.count;
  assert.match(await toHer(String(g)), /Goal reached/);
  assert.match(await toHer("I'll send 5 in the next 20 minutes"), /Deal: 5 more by/);
  assert.equal(task().goal.fromHer, true); assert.equal(task().reportedDone, g, 'a promise is not a count');
  await A.runAgent(Date.now() + 21 * 60000);
  assert.match(db.messages.filter((m) => m.owner === 'teammate').at(-1).text, /goal was \d+ and you are at \d+\. This was your own promise/);

  // Her questions wait for the manager, and his answer goes back to her.
  await toHer('can I take a break?');
  assert.equal(task().pendingAsk.kind, 'break');
  assert.match((await toMgr('status')).me, /waiting for your answer/);
  let r = await toMgr('yes 15 min');
  assert.match(r.her, /take a 15-minute break/); assert.ok(task().breakUntil);
  await A.runAgent(Date.now() + 16 * 60000);
  assert.match(db.messages.filter((m) => m.owner === 'teammate').at(-1).text, /break is over/);
  await toHer('can I take a break?'); await toMgr('yes 15 min');
  assert.match(await toHer("I'm back, continuing now"), /Good, keep going/);
  assert.equal(task().breakUntil, undefined, 'saying she is back ends the break');
  await toHer('what should I write in the DM?');
  r = await toMgr('Use the Eid template');
  assert.match(r.her, /Your manager says: Use the Eid template/);
  await toHer('can I get more time?');
  r = await toMgr('yes 1 hour'); assert.match(r.her, /new deadline/);

  // Manager commands on the running task never turn into a new-task draft.
  r = await toMgr('remind her'); assert.match(r.her, /wants your update now/); assert.equal(db.agent.pendingAssignment, undefined);
  r = await toMgr('change deadline to 10pm'); assert.match(r.me, /New deadline: 10:00 PM/);
  r = await toMgr('give her 1 hour'); assert.match(r.me, /New deadline: 11:00 PM/);
  r = await toMgr('make it 80 DMs'); assert.equal(task().target, 80); assert.match(r.her, /target is now 80/);
  r = await toMgr('why is she so slow?'); assert.match(r.me, /She needs about \d+ per hour/);
  r = await toMgr('what did she say?'); assert.match(r.me, /last messages/);
  r = await toMgr('who are you?'); assert.match(r.me, /I am Wajdan/);
  r = await toMgr('Tell her to send her update now'); assert.match(r.her, /Send your update now/, 'relays speak to her, not about her');
  assert.equal(db.agent.pendingAssignment, undefined, 'no stray drafts');
  console.log('PASS: her questions answered from facts, counts in English/Urdu/bare numbers, pushback on delay, honest cant-finish, blockers clear, manager answers reach her, breaks end with a push, edits/nudge/status never become drafts.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
