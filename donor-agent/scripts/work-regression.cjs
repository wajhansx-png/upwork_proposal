// Quiet hours, fresh push words, and best time. Plain node, fake clock, no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

let db;
let aiOpeners = null; // what the fake AI answers for push openers; null = AI off
let aiCalls = 0;
const pushes = [];
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  const from = parent?.filename ?? '';
  if (from.endsWith(path.join('lib', 'agent.ts'))) {
    if (request === './db') return { readDb: async () => structuredClone(db), withDb: async (fn) => fn(db), newId: () => crypto.randomUUID().slice(0, 8), kvGetImage: async () => null };
    if (request === './push') return { notify: async (...a) => pushes.push(a) };
  }
  if (from.endsWith(path.join('lib', 'understand.ts')) && request === './llm')
    return {
      llm: async (system) => {
        if (/first words of a short push/.test(system)) {
          aiCalls++;
          return aiOpeners ? { text: JSON.stringify({ openers: aiOpeners }), status: 'ok' } : { text: null, status: 'off' };
        }
        return { text: null, status: 'off' };
      },
      parseJson: (t) => { try { return JSON.parse(t); } catch { return null; } },
    };
  return load.call(this, request, parent, ...rest);
};
const { quietUntil, hourLabel } = require('../src/lib/quiet.ts');
const B = require('../src/lib/besttime.ts');
const { cleanNudge, makeNudgeOpeners } = require('../src/lib/understand.ts');
const { runAgent, setProgress, handleTeammateMessage } = require('../src/lib/agent.ts');

const MIN = 60000, HOUR = 3600000;
// Pakistan time is UTC+5 all year: 23:30 PKT = 18:30 UTC.
const pkt = (day, h, m = 0) => Date.UTC(2026, 9, day, h - 5, m);
const S = (o = {}) => ({ timezone: 'Asia/Karachi', quietEnabled: true, quietStartHour: 23, quietEndHour: 8, teammateName: 'Areeba', checkinMinutes: 5, workEndHour: 23, ...o });

(async () => {
  // 1. quietUntil: when it applies, and the one firm rule about deadlines.
  const far = pkt(12, 20); // a deadline two days away: the task runs on past the night
  assert.equal(quietUntil(S(), pkt(10, 14), far), null, 'daytime: not quiet');
  assert.equal(quietUntil(S(), pkt(10, 22, 59), far), null, 'one minute before the night');
  assert.equal(quietUntil(S(), pkt(10, 23, 0), far), pkt(11, 8), 'at 11 pm the night starts and ends at 8 am tomorrow');
  assert.equal(quietUntil(S(), pkt(11, 3), far), pkt(11, 8), 'at 3 am it ends at 8 am today');
  assert.equal(quietUntil(S(), pkt(11, 7, 59), far), pkt(11, 8));
  assert.equal(quietUntil(S(), pkt(11, 8, 0), far), null, 'at 8 am pushes are back');
  assert.equal(quietUntil(S(), pkt(10, 23, 30), pkt(10, 23, 30) + 5 * MIN), null, 'a task due at 11:30 pm is pushed to its deadline');
  assert.equal(quietUntil(S(), pkt(11, 1), pkt(11, 2)), null, 'a task due at 2 am is pushed to its deadline');
  assert.equal(quietUntil(S(), pkt(11, 1), pkt(11, 8)), null, 'a task due exactly when the night ends is not muted');
  assert.equal(quietUntil(S(), pkt(11, 1), pkt(11, 9)), pkt(11, 8), 'a task due at 9 am is muted until 8 am');
  assert.equal(quietUntil(S({ quietEnabled: false }), pkt(11, 3), far), null, 'switched off');
  assert.equal(quietUntil({ timezone: 'Asia/Karachi', quietStartHour: 23, quietEndHour: 8 }, pkt(11, 3), far), null, 'not set up: not quiet');
  assert.equal(quietUntil(S({ quietStartHour: 8, quietEndHour: 8 }), pkt(11, 3), far), null, 'same start and end: not quiet');
  assert.equal(quietUntil(S({ quietStartHour: 1, quietEndHour: 6 }), pkt(11, 3), far), pkt(11, 6), 'a night that does not cross midnight');
  assert.equal(quietUntil(S({ quietStartHour: 1, quietEndHour: 6 }), pkt(11, 7), far), null);
  assert.equal(quietUntil(S({ quietStartHour: 99, quietEndHour: -1 }), pkt(11, 3), far), pkt(11, 8), 'bad hours fall back to 11 pm - 8 am');
  assert.equal(hourLabel(0), '12 am'); assert.equal(hourLabel(12), '12 pm'); assert.equal(hourLabel(23), '11 pm'); assert.equal(hourLabel(8), '8 am');

  // 2. runAgent at night, with a fake clock. Pushes follow the rule; the 4-minute rhythm is not changed.
  const task = (o = {}) => ({ id: 't1', title: 'Send 10 DMs', kind: 'dms', target: 10, status: 'open', createdAt: new Date(pkt(10, 20)).toISOString(), deadlineAt: new Date(pkt(11, 12)).toISOString(), unanswered: 1, startedAt: new Date(pkt(10, 20, 5)).toISOString(), lastReminderAt: new Date(pkt(10, 22, 50)).toISOString(), remindersEnabled: true, ...o });
  const fresh = (t, settings = S()) => { db = { settings, agent: {}, donors: [], cases: [], messages: [], subs: [{ role: 'teammate', sub: { endpoint: 'x', keys: { p256dh: 'a', auth: 'b' } } }], hashes: {}, tasks: [t] }; pushes.length = 0; };
  fresh(task());
  let r = await runAgent(pkt(10, 23, 30));
  assert.deepEqual(r.actions, [], 'night, task runs on past the morning: nothing is sent');
  assert.equal(pushes.length, 0);
  r = await runAgent(pkt(11, 3, 0)); assert.equal(pushes.length, 0, 'still quiet at 3 am');
  r = await runAgent(pkt(11, 7, 59)); assert.equal(pushes.length, 0, 'still quiet at 7:59');
  r = await runAgent(pkt(11, 8, 0));
  assert.deepEqual(r.actions, ['retry'], 'at 8 am the push is back at once');
  assert.equal(pushes.filter((p) => p[0] === 'teammate').length, 1);
  assert.match(db.messages.filter((m) => m.owner === 'teammate').at(-1).text, /asked 2 times/);
  const n0 = pushes.length;
  await runAgent(pkt(11, 8, 3)); assert.equal(pushes.length, n0, 'the 4-minute rhythm is the same: nothing at 3 minutes');
  await runAgent(pkt(11, 8, 4)); assert.equal(pushes.length, n0 + 1, 'and a push at 4 minutes');

  // a task that ends inside the night is still pushed until its deadline
  fresh(task({ deadlineAt: new Date(pkt(11, 2)).toISOString(), lastReminderAt: new Date(pkt(10, 23, 20)).toISOString() }));
  r = await runAgent(pkt(10, 23, 30));
  assert.deepEqual(r.actions, ['retry'], 'a task due at 2 am keeps getting pushed at night');
  r = await runAgent(pkt(11, 2, 1)); assert.deepEqual(r.actions, ['deadline'], 'and its deadline is not muted');

  // switched off: pushes at night
  fresh(task(), S({ quietEnabled: false }));
  r = await runAgent(pkt(11, 3)); assert.deepEqual(r.actions, ['retry']);

  // a break that ends at night is announced in the morning
  fresh(task({ unanswered: 0, breakUntil: new Date(pkt(10, 23, 45)).toISOString() }));
  r = await runAgent(pkt(11, 0, 10)); assert.deepEqual(r.actions, [], 'break over at night: wait');
  r = await runAgent(pkt(11, 8, 0)); assert.deepEqual(r.actions, ['break-over'], 'break-over arrives at 8 am');

  // she can still write at night and gets an answer
  fresh(task());
  const realNow = Date.now;
  Date.now = () => pkt(11, 3);
  await handleTeammateMessage('I sent 3');
  Date.now = realNow;
  assert.equal(db.tasks[0].reportedDone, 3, 'replies and counts still work at night');
  assert.ok(db.messages.some((m) => m.owner === 'teammate' && m.from === 'agent'));

  // 3. Fresh push words: checked, deduped, and the classic first line stays.
  const good = ['{name}, one quick reply please.', '{name}, just one line is enough.', '{name}, a tiny update helps us both.', '{name}, tell me where you are now.', '{name}, one small step, then reply.'];
  for (const g of good) assert.equal(cleanNudge(g), g, g);
  const bad = [
    'Areeba, please reply.', '{name}, {name}, reply.', '{name}, reply in 5 minutes.', '{name}, your manager is angry.', '{name}, we are watching you.',
    '{name}, reply NOW please.', '{name}, kindly reply.', '{name}, reply 🙂.', '{name}, will you reply?', '{name}, reply', '{name}, ok.',
    '{name}, ' + 'word '.repeat(16) + 'end.', '{name}, you will be punished if you stay silent.', 42, null,
  ];
  for (const b of bad) assert.equal(cleanNudge(b), null, String(b));

  aiOpeners = [good[0], good[0], '{name}, one quick reply, please.', '{name}, you are lazy.', good[1], 'no placeholder here.', '{name}, count 7 now.'];
  let list = await makeNudgeOpeners('Areeba', { started: true });
  assert.deepEqual(list, [good[0], good[1]], 'duplicates, near-duplicates and bad lines are dropped');
  list = await makeNudgeOpeners('Areeba', { started: true }, [good[0]]);
  assert.deepEqual(list, [good[1]], 'a line already used is not written again');
  aiOpeners = null;
  assert.deepEqual(await makeNudgeOpeners('Areeba', { started: true }), [], 'AI off: nothing');

  // 4. In the clock: classic first line, then pool lines; same rhythm; refill is rare and safe.
  const quiet = S({ quietEnabled: false });
  aiOpeners = null; aiCalls = 0;
  fresh(task({ unanswered: 1, lastReminderAt: new Date(pkt(10, 20)).toISOString(), deadlineAt: new Date(pkt(10, 23, 50)).toISOString(), nudgePool: ['{name}, one quick reply please.', '{name}, just one line is enough.', '{name}, a tiny update helps us both.'] }), quiet);
  const herText = () => db.messages.filter((m) => m.owner === 'teammate').at(-1).text;
  let t = pkt(10, 20, 10);
  await runAgent(t); assert.match(herText(), /^Areeba, please reply\. How many DMs have you sent\? \(asked 2 times\)$/, 'the first reminder keeps the classic words');
  t += 4 * MIN; await runAgent(t);
  assert.equal(herText(), 'Areeba, one quick reply please. How many DMs have you sent? (asked 3 times)', 'then a fresh opener + the real question + the same counter');
  t += 4 * MIN; await runAgent(t);
  assert.equal(herText(), 'Areeba, just one line is enough. How many DMs have you sent? (asked 4 times)');
  assert.equal(db.tasks[0].nudgePool.length, 1);
  assert.equal(pushes.filter((p) => p[0] === 'teammate').length, 3, 'one push per 4 minutes, as before');
  assert.equal(aiCalls, 1, 'AI off: one cheap try, then it waits 30 minutes; the words and the rhythm are unchanged');
  // pool runs out: back to the classic lines, never an error
  t += 4 * MIN; await runAgent(t); t += 4 * MIN; await runAgent(t);
  assert.match(herText(), /\(asked 6 times\)$/);
  assert.match(herText(), /^Areeba, please reply\. How many DMs have you sent\?/, 'empty pool: back to the classic lines');

  // refill with a working AI: once, then not again for 30 minutes
  aiOpeners = good; aiCalls = 0;
  fresh(task({ unanswered: 1, lastReminderAt: new Date(pkt(10, 20)).toISOString(), deadlineAt: new Date(pkt(10, 23, 50)).toISOString() }), quiet);
  t = pkt(10, 20, 10);
  await runAgent(t); await runAgent(t + 4 * MIN); await runAgent(t + 8 * MIN);
  assert.equal(aiCalls, 1, 'one AI call for the whole 12 minutes');
  assert.equal(db.tasks[0].nudgePool.length >= 3, true, 'the pool is filled');
  await runAgent(t + 12 * MIN);
  assert.match(herText(), /How many DMs have you sent\? \(asked 5 times\)$/);
  assert.equal(aiCalls, 1);
  // a refill with bad AI output adds nothing and does not repeat for 30 minutes
  aiOpeners = ['reply now!!', '{name}, you are lazy.']; aiCalls = 0;
  fresh(task({ unanswered: 1, lastReminderAt: new Date(pkt(10, 20)).toISOString(), deadlineAt: new Date(pkt(10, 23, 50)).toISOString() }), quiet);
  t = pkt(10, 20, 10);
  for (let i = 0; i < 6; i++) await runAgent(t + i * 4 * MIN);
  assert.equal(aiCalls, 1, 'bad AI output: still only one call in 24 minutes');
  assert.ok(!(db.tasks[0].nudgePool ?? []).length, 'nothing bad is stored');
  assert.equal(pushes.filter((p) => p[0] === 'teammate').length, 6, 'and every push still goes out on time');
  aiOpeners = null;

  // 5. Send log: her real counts, and nothing else.
  fresh(task({ unanswered: 0 }), quiet);
  const t0 = pkt(10, 21);
  const rn = Date.now; Date.now = () => t0;
  await setProgress(4);
  assert.equal(db.agent.sendLog.length, 4);
  await setProgress(6); assert.equal(db.agent.sendLog.length, 6);
  await setProgress(5); assert.equal(db.agent.sendLog.length, 5, 'taking one back removes it from the log');
  await setProgress(5); assert.equal(db.agent.sendLog.length, 5, 'no change, no log');
  Date.now = rn;
  assert.deepEqual(B.logSends([], 1, 3), [1, 1, 1]);
  assert.equal(B.logSends([], 1, 500).length, 50, 'one batch never adds more than 50');
  assert.equal(B.logSends(new Array(B.SEND_LOG_CAP).fill(1), 2, 5).length, B.SEND_LOG_CAP, 'the log stays capped');
  assert.deepEqual(B.unlogSends([1, 2, 3], 2), [1]);
  assert.deepEqual(B.unlogSends([1], 5), []);

  // 6. Best time: only from enough real data, and only a clear pattern.
  const day = (d, h) => pkt(d, h, 10);
  const now = pkt(20, 12);
  const log = [];
  for (let d = 10; d <= 15; d++) { for (let k = 0; k < 4; k++) log.push(day(d, 19 + (k % 2))); log.push(day(d, 14)); } // 19-21 heavy, a few at 2 pm
  let bt = B.bestTime(log, 'Asia/Karachi', now);
  assert.equal(bt.from, 19); assert.equal(bt.to, 21); assert.equal(bt.label, '7–9 pm');
  assert.equal(bt.days, 6); assert.equal(bt.total, 30); assert.equal(bt.sends, 24);
  assert.equal(B.bestTime(log.slice(0, 19), 'Asia/Karachi', now), null, 'under 20 DMs: not enough data');
  assert.equal(B.bestTime(log.filter((t) => t < day(12, 0)), 'Asia/Karachi', now), null, 'under 3 days: not enough data');
  assert.equal(B.bestTime(undefined, 'Asia/Karachi', now), null);
  const flat = []; for (let d = 10; d <= 13; d++) for (let h = 0; h < 24; h++) flat.push(day(d, h));
  assert.equal(B.bestTime(flat, 'Asia/Karachi', now), null, 'sends spread over the whole day: no clear best time');
  const wrap = []; for (let d = 10; d <= 14; d++) for (let k = 0; k < 5; k++) wrap.push(day(d, k % 2 ? 23 : 0));
  bt = B.bestTime(wrap, 'Asia/Karachi', now);
  assert.equal(bt.from, 23); assert.equal(bt.label, '11 pm – 1 am', 'a window that crosses midnight');
  const old = log.map((t) => t - 40 * 24 * HOUR);
  assert.equal(B.bestTime(old, 'Asia/Karachi', now), null, 'old data (over 30 days) is ignored');
  assert.equal(B.bestTime([NaN, 'x', now + 99 * HOUR, ...log], 'Asia/Karachi', now).total, 30, 'junk and future times are ignored');
  const morning = []; for (let d = 10; d <= 14; d++) for (let k = 0; k < 5; k++) morning.push(day(d, 9 + (k % 2)));
  assert.equal(B.bestTime(morning, 'Asia/Karachi', now).label, '9–11 am');

  console.log('work regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
