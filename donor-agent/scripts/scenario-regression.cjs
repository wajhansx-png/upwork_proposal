// Real-life simulation with a fake clock: the manager gives tasks, Areeba works, stalls, gets blocked, misses deadlines,
// and the agent gets the work out of her. After EVERY step a set of rules that must always hold is checked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

// Fake clock: Date.now() and new Date() follow `clock`.
const RealDate = Date;
let clock = RealDate.UTC(2026, 9, 9, 13, 0); // 6:00 PM in Karachi
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
};
const MIN = 60000;
const tick = (min) => { clock += min * MIN; };

let db;
const pushes = [];
let pushSource = 'none';
const load = Module._load;
Module._load = function (r, p, ...x) {
  const f = p?.filename ?? '';
  if (f.endsWith(path.join('lib', 'agent.ts')) || f.endsWith(path.join('lib', 'evaluate.ts'))) {
    if (r === './db') return { readDb: async () => structuredClone(db), withDb: async (fn) => fn(db), newId: () => Math.random().toString(36).slice(2, 10), kvGetImage: async () => null };
    if (r === './push') return { notify: async (...a) => { pushes.push({ to: a[0], title: a[1], body: a[2], src: pushSource, at: clock }); return { accepted: 1 }; } };
    if (r === './llm') return { llm: async () => ({ text: null, status: 'off' }), parseJson: () => null };
  }
  if ((f.endsWith('understand.ts')) && r === './llm') return { llm: async () => ({ text: null, status: 'off' }), parseJson: () => null };
  return load.call(this, r, p, ...x);
};
const A = require('../src/lib/agent.ts');
const { evaluatePending } = require('../src/lib/evaluate.ts');

const fresh = () => ({ settings: { teammateName: 'Areeba', timezone: 'Asia/Karachi', checkinMinutes: 5, workEndHour: 23, dailyTarget: 20, teammateKeyVersion: 1 }, agent: {}, tasks: [], donors: [], messages: [], subs: [], hashes: {} });
const task = () => [...db.tasks].reverse().find((t) => ['open', 'review', 'missed'].includes(t.status)) ?? db.tasks.at(-1);
const lastHer = () => db.messages.filter((m) => m.owner === 'teammate' && m.from !== 'user').at(-1)?.text ?? '';
const lastMine = () => db.messages.filter((m) => m.owner === 'manager' && m.from === 'agent').at(-1)?.text ?? '';
let steps = 0;

/** The rules that must hold after every single step. */
function invariants(label) {
  steps++;
  const where = `[${label}]`;
  const live = db.tasks.filter((t) => t.status === 'open' || t.status === 'review');
  assert.ok(live.length <= 1, `${where} more than one live task`);
  for (const t of db.tasks) {
    assert.ok(['open', 'review', 'done', 'missed', 'cancelled'].includes(t.status), `${where} bad status ${t.status}`);
    assert.ok(Number.isFinite(new RealDate(t.deadlineAt).getTime()), `${where} bad deadline`);
    assert.ok(t.target >= 1, `${where} target ${t.target}`);
    if (t.reportedDone !== undefined) assert.ok(t.reportedDone >= 0 && t.reportedDone <= t.target, `${where} count ${t.reportedDone}/${t.target}`);
    assert.ok(t.unanswered >= 0, `${where} unanswered ${t.unanswered}`);
    if (t.goal) assert.ok(t.goal.count >= 0 && t.goal.count <= t.target && Number.isFinite(new RealDate(t.goal.by).getTime()), `${where} bad goal`);
  }
  assert.ok(db.messages.length <= 400, `${where} message log not capped`);
  for (const m of db.messages) {
    assert.ok(typeof m.text === 'string', `${where} message without text`);
    // What the agent writes must never show code words. Her own words (and quotes of them) can say anything.
    const own = m.from === 'agent' ? m.text.replace(/“[^”]*”/g, '').replace(/"[^"]*"/g, '').replace(/(?:Your manager says(?: yes)?|Message from your manager|Your manager answered): .*$/s, '') : '';
    assert.doesNotMatch(own, /undefined|NaN|\[object Object\]|\bnull\b|Infinity/, `${where} broken text: ${m.text.slice(0, 160)}`);
    if (m.from === 'agent') assert.ok(m.text.length < 1200, `${where} agent message too long: ${m.owner} ${m.text.slice(0, 80)}`);
  }
  for (const p of pushes) {
    assert.ok(p.title && typeof p.body === 'string', `${where} empty push`);
    if (p.to === 'manager') assert.notEqual(p.src, 'clock', `${where} the clock pushed the manager: ${p.title}`);
  }
}

const her = async (text) => {
  pushSource = 'her';
  await A.handleTeammateMessage(text);
  pushSource = 'none';
  // Her message is the last one she wrote; the agent's reply must come after it.
  const i = db.messages.map((m) => m.owner === 'teammate' && m.from === 'user').lastIndexOf(true);
  const replies = i < 0 ? [] : db.messages.slice(i + 1).filter((m) => m.owner === 'teammate' && m.from === 'agent');
  if (text.trim()) assert.ok(replies.length >= 1, `every message gets a reply: "${text.slice(0, 40)}"`);
  invariants(`her: ${text.slice(0, 30)}`);
  return replies.map((m) => m.text).join('\n');
};
const me = async (text) => {
  pushSource = 'manager';
  await A.handleManagerMessage(text);
  pushSource = 'none';
  invariants(`me: ${text.slice(0, 30)}`);
  return lastMine();
};
const tap = async (n) => { pushSource = 'her'; await A.setProgress(n); pushSource = 'none'; invariants(`tap ${n}`); };
const wait = async (min, every = 1) => {
  for (let i = 0; i < min; i += every) {
    tick(every);
    pushSource = 'clock';
    await A.runAgent(clock);
    pushSource = 'none';
    invariants(`clock +${i + every}m`);
  }
};
const hersCount = (from) => pushes.slice(from).filter((p) => p.to === 'teammate').length;
const mineCount = (from) => pushes.slice(from).filter((p) => p.to === 'manager').length;

(async () => {
  // ---------- A. A normal evening: silent at first, then works, stalls, finishes ----------
  db = fresh();
  assert.match(await me('Areeba please send 100 DMs by 9pm, previous donors only'), /Done\. Sent to Areeba/);
  assert.match(lastHer(), /New task\nSend 100 DMs\nBy 9:00 PM/);
  let t0 = pushes.length;
  await wait(20);
  assert.ok(hersCount(t0) >= 4, 'silent: she is pushed again and again');
  assert.equal(mineCount(t0), 0, 'silent: the manager is not pushed');
  assert.match(lastMine(), /No update from Areeba/);
  t0 = pushes.length;
  await her('sorry, I started now');
  assert.ok(task().startedAt && task().unanswered === 0);
  assert.equal(mineCount(t0), 1, 'her reply alerts the manager once');
  await her('sent 6');
  await her("I'll send 5 in the next 20 minutes");
  assert.equal(task().goal.fromHer, true);
  await wait(21);
  assert.match(lastHer(), /goal was|Reply|reply|update/i, 'a missed promise gets a push');
  await her('can I take a break?');
  assert.match(await me('status'), /waiting for your answer/);
  await me('yes 15 min');
  assert.ok(task().breakUntil);
  t0 = pushes.length;
  await wait(10);
  assert.equal(hersCount(t0), 0, 'no nudges during an approved break');
  await wait(6);
  assert.match(lastHer(), /break is over/);
  await her('I am tired and stressed');
  await her('later');
  for (let n = 7; n <= 100; n += 9) { await tap(n); tick(3); }
  await tap(100);
  assert.equal(task().status, 'review', 'all sent -> review');
  await evaluatePending();
  assert.ok(task().evaluation, 'a finished task gets a score');
  await me('confirm');
  assert.equal(db.tasks.at(-1).status, 'done');
  await her('thank you');

  // ---------- B. Deadline passes, task is missed, manager gives more time, she finishes late ----------
  db = fresh();
  await me('Areeba send 20 DMs in 30 minutes');
  await her('started');
  await her('5 done');
  await wait(45);
  assert.equal(task().status, 'missed', 'no reply after the deadline -> missed');
  await tap(9);
  assert.equal(task().reportedDone, 9, '+ still works after a miss');
  assert.match(await me('give her 1 hour'), /New deadline/);
  assert.equal(task().status, 'open', 'more time reopens the task');
  await her('20');
  assert.equal(task().status, 'review');

  // ---------- C. Manager changes things mid-task ----------
  db = fresh();
  await me('Areeba send 100 DMs by 11pm');
  await me('change deadline to 10pm');
  assert.match(lastHer(), /new deadline is 10:00 PM/);
  await me('make it 80');
  assert.equal(task().target, 80);
  await me('Areeba send 50 DMs by 9pm');
  assert.ok(db.agent.pendingAssignment, 'a second task waits as a draft');
  assert.equal(db.tasks.filter((t) => t.status === 'open').length, 1);
  await me('replace current task');
  assert.equal(task().target, 50, 'replace switches tasks');
  assert.equal(db.tasks.filter((t) => t.status === 'cancelled').length, 1);
  await me('remind her');
  await me('what did she say?');
  await me('who are you?');
  await me('Tell her to send her update now');
  assert.match(lastHer(), /Send your update now/);
  await me('cancel');
  assert.match(lastMine(), /[Cc]ancel/);
  await me('Areeba send some DMs');
  assert.ok(db.agent.pendingAssignment, 'missing count/time -> the agent asks');
  await me('cancel');
  assert.equal(db.agent.pendingAssignment, undefined);

  // ---------- D. Problems: blocker, questions, cannot finish ----------
  db = fresh();
  await me('Areeba send 40 DMs by 10pm');
  await her('I started');
  await her('my phone died');
  assert.ok(task().blockedReason);
  await her('12');
  assert.equal(task().blockedReason, undefined, 'progress clears the blocker');
  await her('which donors should I message?');
  assert.equal(task().pendingAsk?.kind, 'howto');
  await me('Only the ones from last Ramadan');
  assert.match(lastHer(), /Your manager says: Only the ones from last Ramadan/);
  await her('I cannot do 40 today');
  await me('make it 25');
  assert.equal(task().target, 25);
  await her('can I get more time?');
  await me('no');
  assert.match(lastHer(), /deadline stays/);

  // ---------- E. Nothing to do: no task at all ----------
  db = fresh();
  await her('hi');
  await her('what is my task?');
  await me('status');
  await me('remind her');
  await me('give her 1 hour');
  await me('make it 10');
  await tap(5).catch(() => undefined);
  await wait(10);
  assert.equal(db.tasks.length, 0);

  // ---------- F. Random and broken input, on both sides, for 3 simulated days ----------
  db = fresh();
  const junk = ['', '   ', '😀😀😀', 'ok', '0', '-5', '999999', '1e9', '3.7', 'null', 'undefined', '<script>alert(1)</script>', 'a'.repeat(5000),
    'sent -3', 'sent 1000000', 'I sent 50 of 20', '15/0', '0/0', 'NaN', 'Infinity', 'done done done', '?', '??', '!!!', 'kal', 'main ne bhej diye',
    'change deadline to yesterday', 'give her -1 hours', 'make it 0', 'make it -4', 'make it 99999', 'change deadline to 99pm', 'yes', 'no', 'cancel', 'replace current task',
    'Areeba send 0 DMs by 9pm', 'Areeba send 5 DMs by 5am yesterday', 'Areeba send 10 DMs in 0 minutes', 'Areeba send 1000 DMs in 10 minutes', 'Areeba send 30 DMs by 11pm',
    '\u0000\u0001', 'السلام عليكم', 'آپ کیسے ہیں', '١٢', 'twenty five sent', 'I have a problem', "I'll send 500 in the next 1 minutes", 'remind her'];
  let seed = Number(process.env.SEED ?? 7);
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 600; i++) {
    const text = junk[rnd(junk.length)];
    const pick = rnd(10);
    try {
      if (pick < 4) await her(text);
      else if (pick < 7) await me(text);
      else if (pick < 8) await tap(rnd(130) - 10).catch((e) => { if (!/no DM task|There is no/.test(e.message)) throw e; });
      else await wait(rnd(60) + 1, 5);
    } catch (e) {
      e.message = `fuzz step ${i} (${pick < 4 ? 'her' : pick < 7 ? 'me' : 'other'}: ${JSON.stringify(text.slice(0, 40))}): ${e.message}`;
      throw e;
    }
  }
  await evaluatePending();
  invariants('end');
  console.log(`PASS: real-life scenarios (normal evening, missed deadline + extension, manager edits, problems, no task) and 600 random/broken inputs over 3 simulated days; ${steps} steps, every rule held.`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
