// Group plan: the manager lines up texts with times; Areeba gets each at its time, is pushed when late, and it stops when the case closes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

let aiReply = null;
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  const from = parent?.filename ?? '';
  if ((from.endsWith(path.join('lib', 'groups.ts')) || from.endsWith(path.join('lib', 'case.ts'))) && request === './llm')
    return { llm: async () => ({ text: aiReply, status: aiReply ? 'ok' : 'off' }), parseJson: (t) => { try { return JSON.parse(t); } catch { return null; } } };
  return load.call(this, request, parent, ...rest);
};
const G = require('../src/lib/groups.ts');
const { PAY_SHORT } = require('../src/lib/case-guide.ts');

const MIN = 60_000;
// 7:00 pm in Karachi (UTC+5), so quiet hours (11 pm – 8 am) are not on yet.
const T0 = Date.parse('2026-10-21T14:00:00Z');
const iso = (t) => new Date(t).toISOString();
const facts = { type: 'child', name: 'Affan', gender: 'm', age: 7, city: 'Peshawar', problem: 'Affan is bleeding inside his knee and hand', illness: 'Hemophilia', illnessMeaning: 'blood does not clot', worstRisk: 'he can lose his leg', riskWord: 'LEG', doctorLine: 'delay can put the leg at risk', proof: 'Aga Khan lab report', amountLeft: 26000, askAmount: 2000 };
const freshDb = () => ({ settings: { teammateName: 'Areeba', timezone: 'Asia/Karachi', quietEnabled: true, quietStartHour: 23, quietEndHour: 8 }, agent: {}, donors: [], tasks: [], messages: [], subs: [], hashes: {},
  cases: [{ id: 'c1', facts: { ...facts }, status: 'open', createdAt: iso(T0), hook: 'This is about a child keeping his LEG.', story: 'Helpless Affan is bleeding inside.', verse: 0, by: 'rules', posts: [] }] });
let n = 0;
const add = (db, kind, at, text) => G.changePlan(db, { action: 'add', kind, at: iso(at), text, id: `p${++n}` }, T0);

(async () => {
  // 1. Planning: the case and two texts, sorted by time; the case post only once; honesty rules on his own text.
  {
    const db = freshDb();
    assert.equal(add(db, 'line', T0 + 120 * MIN, 'Affan is still waiting.\nBe the one who helps.'), null);
    assert.equal(add(db, 'case', T0 + 10 * MIN), null);
    assert.equal(add(db, 'line', T0 + 240 * MIN, 'Think of your own child.\nNow think of Affan.'), null);
    assert.deepEqual(db.cases[0].plan.map((p) => p.kind), ['case', 'line', 'line'], 'sorted by time');
    assert.match(add(db, 'case', T0 + 20 * MIN), /already in the plan/);
    assert.match(add(db, 'line', T0 + 20 * MIN, 'Affan will die tonight.'), /breaks a rule/, 'a new claim is refused');
    assert.match(add(db, 'line', T0 + 20 * MIN, '   '), /Write the text/);
    assert.equal(add(db, 'line', T0 - 60 * MIN, 'Affan is still waiting for help.') , null);
    assert.equal(db.cases[0].plan[0].at, iso(T0), 'a time in the past becomes now');
    const empty = freshDb();
    empty.cases[0].status = 'closed';
    assert.match(add(empty, 'case', T0), /no open case/);
  }

  // 2. Delivery: nothing before the time; at the time she gets a push and the exact text; she never sees later texts early.
  {
    const db = freshDb();
    add(db, 'case', T0 + 10 * MIN);
    add(db, 'line', T0 + 120 * MIN, 'Affan is still waiting.\nBe the one who helps.');
    assert.equal(G.runPlan(db, T0 + 9 * MIN).length, 0, 'nothing before its time');
    let her = G.planView(db, 'teammate', T0 + 9 * MIN);
    assert.equal(her.items.length, 0);
    assert.equal(her.next, iso(T0 + 10 * MIN), 'she sees only when the next one comes');
    assert.ok(!JSON.stringify(her).includes('still waiting'), 'she never sees a later text early');
    let p = G.runPlan(db, T0 + 10 * MIN);
    assert.equal(p.length, 1);
    assert.equal(p[0].role, 'teammate');
    assert.equal(p[0].url, '/areeba/posts');
    assert.match(p[0].title, /case/i);
    her = G.planView(db, 'teammate', T0 + 10 * MIN);
    assert.equal(her.items.length, 1);
    assert.match(her.items[0].text, /Affan/);
    assert.match(her.items[0].text, /03097458815/, 'the case post has the pay block');
    assert.equal(G.runPlan(db, T0 + 10 * MIN).length, 0, 'never sent twice');
    // The emotional text gets the amount and pay line, made at send time with the current amount.
    db.cases[0].facts.amountLeft = 18000;
    G.markPosted(db, db.cases[0].plan[0].id, T0 + 15 * MIN);
    p = G.runPlan(db, T0 + 120 * MIN);
    assert.equal(p.filter((x) => x.role === 'teammate').length, 1);
    const line = db.cases[0].plan[1].shownText;
    assert.ok(line.startsWith('Affan is still waiting.'), line);
    assert.ok(line.includes(`18k left — ${PAY_SHORT} @all`), 'pay line with the current amount');
  }

  // 3. Late: pushed every 10 minutes, manager told once at 30 minutes, nothing at night, done stops it.
  {
    const db = freshDb();
    add(db, 'case', T0);
    G.runPlan(db, T0);
    assert.equal(G.runPlan(db, T0 + 9 * MIN).length, 0);
    let p = G.runPlan(db, T0 + 10 * MIN);
    assert.deepEqual(p.map((x) => x.role), ['teammate'], 'push at 10 minutes');
    assert.equal(G.runPlan(db, T0 + 15 * MIN).length, 0);
    p = G.runPlan(db, T0 + 30 * MIN);
    assert.deepEqual(p.map((x) => x.role).sort(), ['manager', 'teammate'], 'manager told at 30 minutes');
    assert.match(p.find((x) => x.role === 'manager').body, /Areeba has not posted group message 1/);
    p = G.runPlan(db, T0 + 60 * MIN);
    assert.deepEqual(p.map((x) => x.role), ['teammate'], 'manager told only once');
    assert.equal(G.planView(db, 'manager', T0).items[0].state, 'waiting');
    assert.equal(G.markPosted(db, db.cases[0].plan[0].id, T0 + 61 * MIN), null);
    assert.equal(G.runPlan(db, T0 + 90 * MIN).length, 0, 'posted: no more pushes');
    assert.equal(G.planView(db, 'manager', T0).items[0].state, 'posted');
    assert.equal(G.planPending(db.cases[0]), false, 'clock can stop');
    // Night: 11:30 pm Karachi. Delivery still happens at the time he chose, but no nagging.
    const night = Date.parse('2026-10-21T18:30:00Z');
    const d2 = freshDb();
    G.changePlan(d2, { action: 'add', kind: 'case', at: iso(night), id: 'n1' }, night);
    assert.equal(G.runPlan(d2, night).length, 1, 'his chosen time is kept');
    assert.equal(G.runPlan(d2, night + 20 * MIN).length, 0, 'no nagging at night');
  }

  // 4. Changes: move, send now, remove; none of them once she has it. Closing the case stops everything.
  {
    const db = freshDb();
    add(db, 'line', T0 + 60 * MIN, 'Affan is still waiting.\nBe the one who helps.');
    add(db, 'line', T0 + 180 * MIN, 'Think of your own child.\nNow think of Affan.');
    const [a, b] = db.cases[0].plan;
    assert.equal(G.changePlan(db, { action: 'edit', id: b.id, at: iso(T0 + 30 * MIN) }, T0), null);
    assert.equal(db.cases[0].plan[0].id, b.id, 'moved earlier = first');
    assert.equal(G.changePlan(db, { action: 'now', id: a.id }, T0), null);
    G.runPlan(db, T0);
    assert.match(G.changePlan(db, { action: 'edit', id: a.id, text: 'x' }, T0), /already got/);
    assert.match(G.changePlan(db, { action: 'remove', id: a.id }, T0), /stays until she posts/);
    assert.equal(G.changePlan(db, { action: 'remove', id: b.id }, T0), null);
    assert.equal(db.cases[0].plan.length, 1);
    add(db, 'line', T0 + 60 * MIN, 'Many saw this case.\nFew helped.');
    db.cases[0].status = 'closed';
    assert.equal(G.runPlan(db, T0 + 120 * MIN).length, 0, 'closed case: nothing more goes out');
    assert.equal(G.planView(db, 'teammate', T0).items.length, 0);
    assert.match(G.markPosted(db, a.id, T0), /not here/);
  }

  // 5. Emotional texts: AI lines that break honesty rules are dropped; the guide fills the gap; 5 come back.
  {
    const db = freshDb();
    const c = db.cases[0];
    aiReply = JSON.stringify({ texts: [
      'Affan is still waiting.\nWe scroll, he waits. 💔',
      'Affan will die tonight without help.',
      'Imagine your own son bleeding inside.\nAffan lives this every day.',
      'Kindly make a generous contribution.',
      'Only 5000 people can save him.',
      'Many saw Affan.\nFew helped.\nBe one of the few today. 🤲',
    ] });
    const r = await G.emotionalLines(c);
    assert.equal(r.by, 'ai');
    assert.equal(r.lines.length, 5);
    assert.ok(r.lines.includes('Affan is still waiting.\nWe scroll, he waits. 💔'));
    assert.ok(!r.lines.some((l) => /die|tonight|Kindly|5000/.test(l)), 'claims, deadlines, begging, made-up numbers are dropped');
    assert.ok(r.dropped.length >= 3);
    aiReply = null;
    const off = await G.emotionalLines(c);
    assert.equal(off.by, 'rules');
    assert.ok(off.lines.length >= 4, 'no AI: guide lines still come');
    for (const l of off.lines) assert.deepEqual(G.emotionalProblems(l, c.facts), [], `guide line passes its own checks: ${l}`);
    assert.ok(G.emotionalProblems('26k left for Affan.', c.facts).length === 0, 'the real amount is allowed');
    assert.ok(G.emotionalProblems('30k left for Affan.', c.facts).some((x) => x.startsWith('number')), 'a wrong amount is not');
  }

  // 6. His own case text: sent exactly as written; never blocked for style; AI lines may use facts from his text.
  {
    const own = "Little Yousuf is only 2 years old & fluid is filling inside his brain.💔\n\nHis both kidneys are badly swollen because urine goes back into them.\n\n🚨 Rs. 70,000 needed.\n\n- 🤲 Just 35 kind people donating Rs. 2,000 can save Yousaf.\n\n📲 03097458815 — Easypaisa / JazzCash\n👤 Wajdan Khan — GiveLife Foundation";
    const db = freshDb();
    const c = db.cases[0];
    c.ownText = own;
    c.facts = { type: 'child', name: 'Yousuf', gender: 'm', age: 2, problem: 'fluid is filling inside his brain', proof: '', amountLeft: 70000, askAmount: 2000 };
    G.changePlan(db, { action: 'add', kind: 'case', at: iso(T0), id: 'own1' }, T0);
    G.runPlan(db, T0);
    assert.equal(G.planView(db, 'teammate', T0).items[0].text, own, 'his text, every word, nothing added');
    const { caseView } = require('../src/lib/case.ts');
    const v = caseView(c, []);
    assert.equal(v.main.text, own);
    assert.ok(v.main.checks.every((x) => x.ok), 'his own style is never blocked');
    assert.ok(v.dm.text.startsWith('Ali Bhai,') && v.dm.text.includes('Little Yousuf'), 'DM = greeting + his text');
    assert.deepEqual(G.emotionalProblems('Yousuf has fluid in his brain.\nHis kidneys are swollen.', c.facts, [], own), [], 'facts from his text are allowed');
    assert.ok(G.emotionalProblems('Yousuf has cancer.', c.facts, [], own).some((x) => x.startsWith('new claim')), 'but nothing new');
    assert.ok(!G.fallbackLines(c).some((l) => /kind people/.test(l)), 'never an N-people line that could contradict his numbers');
    c.facts.amountLeft = 0;
    assert.ok(!G.payLine(c).includes('0 left'), 'no "0 left" when the amount is unknown');
  }

  console.log('groups regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
