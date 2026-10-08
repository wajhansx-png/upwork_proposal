const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

const now = Date.now();
const MIN = 60000;
let db;
let aiReply = null; // what the fake GPT answers; null = AI failed
const aiCalls = [];
const pushes = [];
const fakeDb = { readDb: async () => structuredClone(db), withDb: async (fn) => fn(db), newId: () => crypto.randomUUID().slice(0, 8), kvGetImage: async () => null };
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  const from = parent?.filename ?? '';
  if (from.endsWith(path.join('lib', 'evaluate.ts')) || from.endsWith(path.join('lib', 'agent.ts'))) {
    if (request === './db') return fakeDb;
    if (request === './push') return { notify: async (...a) => pushes.push(a) };
    if (request === './llm') return { llm: async (sys, user) => { aiCalls.push(user); return aiReply ? { text: JSON.stringify(aiReply), status: 'ok' } : { text: null, status: 'error: test' }; }, parseJson: (t) => { try { return JSON.parse(t); } catch { return null; } }, visionEnabled: () => true };
    if (request === './vision') return { readScreenshot: async () => ({ seen: null, status: 'ok' }), nameMatches: () => false, checkProof: async () => null };
  }
  return load.call(this, request, parent, ...rest);
};
const { ruleScore, taskFacts, evaluatePending } = require('../src/lib/evaluate.ts');
const { runAgent } = require('../src/lib/agent.ts');

const ev = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ imageId: `i${i}`, at: new Date(now).toISOString(), verdict: 'supported', recipient: `Donor ${i}`, reason: 'ok', quality: 4, ...extra }));
const fresh = (task) => ({ settings: { teammateName: 'Areeba', timezone: 'Asia/Karachi', checkinMinutes: 5, workEndHour: 23 }, agent: {}, donors: [], messages: [], subs: [{ role: 'teammate', sub: { endpoint: 'x', keys: { p256dh: 'a', auth: 'b' } } }], hashes: {}, tasks: [task] });
const base = (o = {}) => ({ id: 't1', title: 'Send 10 DMs', kind: 'dms', target: 10, status: 'review', createdAt: new Date(now - 60 * MIN).toISOString(), deadlineAt: new Date(now + 60 * MIN).toISOString(), startedAt: new Date(now - 55 * MIN).toISOString(), reviewAt: new Date(now).toISOString(), unanswered: 0, ...o });

(async () => {
  // 1. Numbers: perfect proven work scores high; claims without proof score low.
  db = fresh(base({ reportedDone: 10, evidence: ev(10) }));
  const perfect = ruleScore(taskFacts(db.tasks[0], db, now));
  assert.ok(perfect >= 9, `perfect work should score >= 9, got ${perfect}`);
  db = fresh(base({ reportedDone: 10, evidence: ev(3) }));
  const claimed = ruleScore(taskFacts(db.tasks[0], db, now));
  assert.ok(claimed <= 5, `10 claimed but 3 proven should score <= 5, got ${claimed}`);
  db = fresh(base({ reportedDone: 10, evidence: [...ev(8), { imageId: 'd', at: '', verdict: 'rejected', reason: 'Duplicate image; no new work verified.' }] }));
  assert.ok(ruleScore(taskFacts(db.tasks[0], db, now)) < perfect, 'a duplicate screenshot must lower the score');

  // 2. GPT cannot inflate: it says 10, numbers say ~4 → kept within 1.5 points.
  db = fresh(base({ reportedDone: 10, evidence: ev(3) }));
  aiReply = { score: 10, good: ['Great effort'], problems: [], advice: 'Thank her.' };
  assert.equal(await evaluatePending(), 1);
  const e = db.tasks[0].evaluation;
  assert.equal(e.by, 'ai');
  assert.ok(e.score <= claimed + 1.5 + 1e-9, `GPT score must stay within 1.5 of ${claimed}, got ${e.score}`);
  assert.match(db.messages.at(-1).text, /Score: .*\/10/);
  assert.match(db.messages.at(-1).text, /3 of 10 verified, 10 claimed/);
  assert.match(aiCalls.at(-1), /"verified":3/, 'GPT must be given the app numbers');
  assert.ok(pushes.some((p) => p[0] === 'manager' && /Task review/.test(p[1])), 'manager gets a review alert');

  // 3. Reviewed once only.
  assert.equal(await evaluatePending(), 0, 'a reviewed task is not reviewed again');

  // 4. AI fails → a review from the numbers, still useful.
  db = fresh(base({ reportedDone: 10, evidence: ev(3) }));
  aiReply = null;
  await evaluatePending();
  assert.equal(db.tasks[0].evaluation.by, 'rules');
  assert.ok(db.tasks[0].evaluation.problems.some((p) => /Said 10, but only 3 are proven/.test(p)));

  // 5. The manager's "check every 20 min" is used for report requests.
  db = fresh(base({ status: 'open', reviewAt: undefined, checkEvery: 20, nextCheckAt: new Date(now - 1000).toISOString(), startedAt: new Date(now - 10 * MIN).toISOString(), evidence: [] }));
  await runAgent(now);
  assert.equal(new Date(db.tasks[0].nextCheckAt).getTime(), now + 20 * MIN, 'next check must be 20 minutes later');

  // 6. After the deadline: 3 final requests 10 minutes apart, then closed as missed (no endless alerts).
  db = fresh(base({ status: 'open', reviewAt: undefined, deadlineAt: new Date(now - MIN).toISOString(), nextCheckAt: new Date(now - 1000).toISOString(), evidence: ev(2) }));
  const urgent = () => pushes.filter((p) => p[1] === 'Urgent: final report').length;
  const before = urgent();
  for (let i = 0; i < 6; i++) await runAgent(now + i * 10 * MIN);
  assert.equal(urgent() - before, 3, 'exactly 3 final requests');
  assert.equal(db.tasks[0].status, 'missed');
  aiReply = { score: 3, good: [], problems: ['Deadline missed.'], advice: 'Talk to her.' };
  await evaluatePending();
  assert.ok(db.tasks[0].evaluation, 'a missed task gets a review');

  console.log('PASS: rule score, GPT kept within 1.5 points, single review, rules fallback, check-every honored, 3 final requests then missed + reviewed.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
