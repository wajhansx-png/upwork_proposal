// Saved messages: the manager saves texts; Areeba sees the same list. AI texts are checked for honesty.
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
  if ((from.endsWith(path.join('lib', 'saved.ts')) || from.endsWith(path.join('lib', 'case.ts'))) && request === './llm')
    return { llm: async () => ({ text: aiReply, status: aiReply ? 'ok' : 'off' }), parseJson: (t) => { try { return JSON.parse(t); } catch { return null; } } };
  return load.call(this, request, parent, ...rest);
};
const S = require('../src/lib/saved.ts');
const { PAY_SHORT } = require('../src/lib/case-guide.ts');

const T0 = Date.parse('2026-10-21T14:00:00Z');
const facts = { type: 'child', name: 'Affan', gender: 'm', age: 7, city: 'Peshawar', problem: 'Affan is bleeding inside his knee and hand', illness: 'Hemophilia', illnessMeaning: 'blood does not clot', worstRisk: 'he can lose his leg', riskWord: 'LEG', doctorLine: 'delay can put the leg at risk', proof: 'Aga Khan lab report', amountLeft: 26000, askAmount: 2000 };
const freshDb = () => ({ settings: { teammateName: 'Areeba', timezone: 'Asia/Karachi' }, agent: {}, donors: [], tasks: [], messages: [], subs: [], hashes: {},
  cases: [{ id: 'c1', facts: { ...facts }, status: 'open', createdAt: new Date(T0).toISOString(), hook: 'h', story: 's', verse: 0, by: 'rules', posts: [] }] });

(async () => {
  // 1. The list: newest first, no empty, no duplicates, max 50, delete, her use marks.
  {
    const db = freshDb();
    assert.match(S.saveMessage(db, '   ', 'a', T0), /Write the message/);
    assert.equal(S.saveMessage(db, 'First text', 'a', T0), null);
    assert.equal(S.saveMessage(db, 'Second text', 'b', T0 + 1), null);
    assert.deepEqual(db.saved.map((m) => m.id), ['b', 'a'], 'newest first');
    assert.match(S.saveMessage(db, 'First text', 'c', T0), /already saved/);
    assert.equal(S.markUsed(db, 'a', T0 + 5), null);
    assert.equal(S.markUsed(db, 'a', T0 + 6), null);
    assert.equal(db.saved[1].uses, 2);
    assert.equal(db.saved[1].usedAt, new Date(T0 + 6).toISOString());
    assert.equal(S.removeMessage(db, 'a'), null);
    assert.match(S.removeMessage(db, 'a'), /already gone/);
    assert.match(S.markUsed(db, 'a', T0), /gone/);
    for (let i = 0; i < 60; i++) S.saveMessage(db, `text ${i}`, `x${i}`, T0 + i);
    assert.equal(db.saved.length, S.MAX_SAVED, 'capped');
    assert.equal(db.saved[0].text, 'text 59');
  }

  // 2. AI texts: claims, deadlines, begging, made-up numbers dropped; ready-made lines fill the gap; pay line added once.
  {
    const c = freshDb().cases[0];
    aiReply = JSON.stringify({ texts: [
      'Affan is still waiting.\nWe scroll, he waits. 💔',
      'Affan will die tonight without help.',
      'Kindly make a generous contribution.',
      'Only 5000 people can save him.',
      'Many saw Affan.\nFew helped.\nBe one of the few today. 🤲',
    ] });
    const r = await S.emotionalLines(c);
    assert.equal(r.by, 'ai');
    assert.equal(r.lines.length, 5);
    assert.ok(r.lines.includes('Affan is still waiting.\nWe scroll, he waits. 💔'));
    assert.ok(!r.lines.some((l) => /die|tonight|Kindly|5000/.test(l)));
    assert.equal(r.dropped.length, 3);
    const w = S.withPayLine(c, r.lines[0]);
    assert.ok(w.endsWith(`26k left — ${PAY_SHORT} @all`));
    assert.equal(S.withPayLine(c, w), w, 'pay line never added twice');
    aiReply = null;
    const off = await S.emotionalLines(c, [r.lines[0]]);
    assert.equal(off.by, 'rules');
    assert.ok(off.lines.length >= 4);
    for (const l of off.lines) assert.deepEqual(S.emotionalProblems(l, c.facts), []);
  }

  // 3. His own case text: AI texts may use its facts, never new ones; no "N people" line that could contradict his numbers.
  {
    const c = freshDb().cases[0];
    c.ownText = 'Little Yousuf is only 2 years old & fluid is filling inside his brain.\nHis both kidneys are badly swollen.\nRs. 70,000 needed.\nJust 35 kind people donating Rs. 2,000 can save Yousaf.';
    c.facts = { type: 'child', name: 'Yousuf', gender: 'm', age: 2, problem: 'fluid is filling inside his brain', proof: '', amountLeft: 70000, askAmount: 2000 };
    assert.deepEqual(S.emotionalProblems('Yousuf has fluid in his brain.\nHis kidneys are swollen.', c.facts, [], c.ownText), []);
    assert.ok(S.emotionalProblems('Yousuf has cancer.', c.facts, [], c.ownText).some((x) => x.startsWith('new claim')));
    assert.ok(!S.fallbackLines(c).some((l) => /kind people/.test(l)));
    c.facts.amountLeft = 0;
    assert.ok(!S.payLine(c).includes('0 left'));
  }

  console.log('saved regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
