const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

let aiReply = null; // what the fake AI answers; null = AI off
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if ((parent?.filename ?? '').endsWith(path.join('lib', 'case.ts')) && request === './llm')
    return { llm: async () => (aiReply ? { text: JSON.stringify(aiReply), status: 'ok' } : { text: null, status: 'off' }), parseJson: (t) => { try { return JSON.parse(t); } catch { return null; } } };
  return load.call(this, request, parent, ...rest);
};
const C = require('../src/lib/case.ts');

const affan = { type: 'child', name: 'Affan', gender: 'm', age: 7, city: 'Peshawar', problem: 'bleeding inside, and blood is collecting in his knee and hand', illness: 'hemophilia', illnessMeaning: 'his bleeding does not stop', worstRisk: 'leg and hand can be removed', riskWord: 'LEG', doctorLine: 'delay can put them at risk of removal', proof: "Aga Khan lab report + Nishtar doctor's diagnosis", amountLeft: 26000, askAmount: 2000 };
const mkCase = (facts, o = {}) => ({ id: 'c1', facts, status: 'open', createdAt: new Date().toISOString(), hook: '', story: '', verse: 0, by: 'rules', posts: [], ...o });

(async () => {
  // 1. Numbers (Part 5, Part 14 mistakes).
  assert.equal(C.peopleNeeded(26000, 2000), 13);
  assert.equal(C.peopleNeeded(28000, 2000), 14);
  assert.equal(C.peopleNeeded(37000, 1500), 25);
  assert.deepEqual(C.fitAsk(60000, 1000), { ask: 3000, n: 20, raised: true, any: false });
  assert.equal(C.fitAsk(900000, 1000).any, true);
  assert.equal(C.k(19000), '19k');
  assert.equal(C.k(17400), '17.4k');
  assert.equal(C.k(8000), '8k');
  assert.equal(C.k(950), '950');
  assert.equal(C.itemsTotal({ items: [{ item: 'Ration', amount: 12000 }, { item: 'Rent', amount: 43000 }] }), 55000, 'Charsadda: the app adds up the items itself');
  assert.equal(C.boldUnicode('AB'), '𝗔𝗕');

  // 2. Facts: required inputs, nothing guessed.
  assert.deepEqual(C.missingFacts({ type: 'child', name: 'X' }), ['What is happening (easy words)', "What will be lost (the doctor's words)", 'What the doctor said (real words)', 'Proof you have (report, hospital)', 'Amount left (Rs)', 'Ask per person (Rs)']);
  assert.ok(!C.missingFacts({ type: 'death', name: 'Sohail', problem: 'x', proof: 'y', amountLeft: 1, askAmount: 1 }).length, 'no doctor needed for a janazah');
  const cf = C.cleanFacts({ doctorLine: 'Doctors said that delay can put them at risk of removal.', riskWord: 'leg!', amountLeft: '26,000', askAmount: -5, type: 'weird' });
  assert.equal(cf.doctorLine, 'delay can put them at risk of removal');
  assert.equal(cf.riskWord, 'LEG');
  assert.equal(cf.amountLeft, 26000);
  assert.equal(cf.askAmount, 0);
  assert.equal(cf.type, 'child');
  assert.deepEqual(C.numbersIn('26k left, ask 2,000, age 7, 1.5 hazar'), [26000, 2000, 7, 1500]);

  // 3. Reading details: AI numbers that are not in the text are dropped; ask defaults to 2,000 with a note.
  aiReply = { type: 'child', name: 'Affan', gender: 'm', age: 9, problem: 'bleeding inside', amountLeft: 30000, askAmount: null, doctorLine: 'delay is risky', proof: 'Aga Khan report' };
  const read = await C.readDetails('Affan, 7 saal ka bacha, Peshawar. Doctor ne kaha delay is risky. 26k baqi hai. Aga Khan report.');
  assert.equal(read.facts.age, undefined, 'age 9 is not in the text');
  assert.equal(read.facts.amountLeft, 0, '30000 is not in the text');
  assert.equal(read.facts.askAmount, 2000);
  assert.ok(read.notes.some((n) => /set to Rs 2,000/.test(n)));
  assert.ok(read.missing.includes('Amount left (Rs)'));
  aiReply = { type: 'child', name: 'Zara', gender: 'f', problem: 'sick', doctorLine: 'very serious', amountLeft: 5000 };
  const r2 = await C.readDetails('Ali needs 5000 for treatment');
  assert.equal(r2.facts.name, '', 'a name that is not in the text is a guess');
  assert.equal(r2.facts.doctorLine, undefined, 'no doctor in the text, no doctor line');
  aiReply = null;
  const r3 = await C.readDetails('Affan case: 26,000 remaining');
  assert.equal(r3.by, 'rules');
  assert.equal(r3.facts.amountLeft, 26000);

  // 4. AI lines are checked; bad ones fall back to the formula.
  const f = C.cleanFacts(affan);
  aiReply = { hook: 'Little Affan could lose his LEG. Only you can change that.', story: 'Little Affan has hemophilia (his bleeding does not stop). Blood is filling his knee and hand.' };
  let w = await C.writeLines(f, []);
  assert.equal(w.by, 'ai');
  assert.equal(w.hook, aiReply.hook);
  const bad = [
    ['Affan has only 48 hours to save his LEG.', /deadline|claim|number/],
    ['This is not about money. This is about a child keeping his LEG or losing it. You decide.', /copied/],
    ['Kindly help Affan save his LEG.', /begging/],
    ['AFFAN could lose his LEG.', /CAPITALS/],
    ['🩸 Affan could lose his LEG.', /emoji/],
    ['Affan is on a ventilator and may lose his LEG.', /claim/],
  ];
  for (const [hook, why] of bad) assert.match(C.lineProblems(hook, f, 'hook').join(','), why, hook);
  aiReply = { hook: 'Affan has only 48 hours left. Save his LEG.', story: 'Doctors say Affan will die.' };
  w = await C.writeLines(f, []);
  assert.equal(w.by, 'rules');
  assert.equal(w.hook, 'This is not about money. This is about Affan keeping his LEG or losing it. You decide.');
  assert.equal(w.story, 'Helpless Affan has hemophilia (his bleeding does not stop). He is bleeding inside, and blood is collecting in his knee and hand.');
  assert.equal(w.dropped.length, 2);
  // A recent case used the first formula: the next one is picked.
  w = await C.writeLines(f, ['This is not about money. This is about Bilal keeping his KIDNEY or losing it. You decide.']);
  assert.match(w.hook, /^A child is at risk of losing his LEG/);

  // 5. The main post: Part 4 shape, all Part 10 checks pass.
  const c = mkCase(f, { hook: 'This is not about money. This is about a child keeping his LEG or losing it. You decide.', story: 'Helpless Affan is bleeding inside, and blood is collecting in his knee and hand.' });
  const main = C.caseText(c);
  const expected = `*This is not about money. This is about a child keeping his LEG or losing it. You decide.*
_Helpless Affan is bleeding inside, and blood is collecting in his knee and hand. Doctors said delay can put them at risk of removal._ 💔
Aga Khan lab report + Nishtar doctor's diagnosis attached
___________

"Who will lend Allah a good loan, so He may multiply it many times?" — Qur'an 2:245 ✅
- *Allah is giving you this chance.*

- *_13 kind people donating 2,000 is enough to save Affan_*. 🤲

_Allah promises to multiply what you give. No bank gives that return._

⚠️ Takes only 10 seconds
📲 03097458815 — Easypaisa/JazzCash
Wajdan Khan — GiveLife Foundation

*Please send a screenshot when you do your part.*

- Wajdan Khan Team - Givelife Foundation @all`;
  assert.equal(main, expected);
  for (const ch of C.checkText(c, main, 'main')) assert.ok(ch.ok, ch.label);
  const dm = C.caseText(c, { greet: C.dmGreeting('Ali', false) });
  assert.match(dm, /^Ali Bhai,\n\n\*This is not/);
  assert.match(dm, /\*Can you be one of the 13\?\* 🤲/);
  assert.ok(!dm.includes('@all'));
  for (const ch of C.checkText(c, dm, 'dm')) assert.ok(ch.ok, ch.label);
  assert.equal(C.dmGreeting('Iqra', true), 'Iqra Behen,');
  assert.equal(C.dmGreeting('', false), 'Assalam o Alaikum,');
  // A wrong number is caught.
  assert.ok(C.checkText(c, '- *_19 kind people donating 2,000 is enough to save Affan_*.', 'main').some((x) => !x.ok));
  assert.ok(C.checkText(c, 'Send to 03001234567', 'main').some((x) => !x.ok && /Payment/.test(x.label)));
  assert.ok(C.checkText(c, 'Doctors gave only 48 hours', 'main').some((x) => !x.ok && /deadline/.test(x.label)));

  // 6. Reminders follow Part 6: changed number, mix of types, last push when N is small, no repeats, nothing after closing.
  c.posts.push({ kind: 'main', text: main, at: '', amountLeft: 26000 });
  c.facts.amountLeft = 19000;
  let r = C.nextReminder(c, ['Ahmed']);
  assert.deepEqual(r, { kind: 'number', text: '19k remaining' });
  c.posts.push({ kind: r.kind, text: r.text, at: '', amountLeft: 19000 });
  r = C.nextReminder(c, ['Ahmed']);
  assert.equal(r.kind, 'people');
  assert.equal(r.text, '*_Just 2,000 by 10 kind people can save him_*\nAllah has given you a chance to save him @all');
  c.posts.push({ kind: r.kind, text: r.text, at: '', amountLeft: 19000 });
  r = C.nextReminder(c, ['Ahmed']);
  assert.equal(r.kind, 'proof', 'feeling is skipped: the family did not say it');
  c.posts.push({ kind: r.kind, text: r.text, at: '', amountLeft: 19000 });
  r = C.nextReminder(c, ['Ahmed', 'Bilal']);
  assert.equal(r.text, '@Ahmed @Bilal\nRequesting all donors to please consider asap');
  c.posts.push({ kind: r.kind, text: r.text, at: '', amountLeft: 19000 });
  assert.equal(C.nextReminder(c, ['Ahmed']), null, 'nothing new to say until the amount changes: never repeat the same number or text');
  c.facts.amountLeft = 16000;
  r = C.nextReminder(c, ['Ahmed']);
  assert.equal(r.kind, 'unity');
  assert.match(r.text, /^16k is left\.\n\*As Muslims, we should unite just to help this child by donating whatever we can, brothers\/sisters\*\n03097458815 - Easypaisa\/Jazzcash - Wajdan Khan \(foundation account\)$/);
  for (const ch of C.checkText(c, r.text, r.kind)) assert.ok(ch.ok, ch.label);
  c.posts.push({ kind: r.kind, text: r.text, at: '', amountLeft: 16000 });
  c.facts.amountLeft = 8000;
  r = C.nextReminder(c, []);
  assert.equal(r.kind, 'lastpush');
  assert.equal(r.text, 'Just 8k left.\n4 people donating 2,000 will save this child 💔\nYour 10 seconds can bring someone peace @all');
  for (const ch of C.checkText(c, r.text, r.kind)) assert.ok(ch.ok, ch.label);
  c.posts.push({ kind: r.kind, text: r.text, at: '', amountLeft: 8000 });
  assert.notEqual(C.nextReminder(c, []).kind, 'lastpush', 'no two last pushes in a row');
  c.facts.amountLeft = 0;
  assert.equal(C.nextReminder(c, []), null);
  c.status = 'closed';
  c.facts.amountLeft = 5000;
  assert.equal(C.nextReminder(c, []), null, 'closed case: no reminders');

  // 7. Closing post.
  const close = C.closingText(c);
  assert.match(close, /^𝗔𝗙𝗙𝗔𝗡'𝗦 𝗖𝗔𝗦𝗘 𝗜𝗦 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘\. 🤲/);
  assert.match(close, /bring complete shifa to Affan/);

  // 8. Other types.
  const sohail = C.cleanFacts({ type: 'death', name: 'Sohail', gender: 'm', problem: 'Sohail has passed away, and his family cannot pay for his janazah', proof: 'Family CNIC and death certificate', amountLeft: 40000, askAmount: 2000, items: [{ item: 'Kafan', amount: 6000 }, { item: 'Grave digging', amount: 10000 }] });
  const sc = mkCase(sohail, { hook: C.fallbackHooks(sohail)[0], story: C.fallbackStory(sohail) });
  const st = C.caseText(sc);
  assert.match(st, /Help do a Muslim brother's janazah/);
  assert.match(st, /20 kind people donating 2,000 is enough to give Sohail a dignified farewell/);
  assert.match(st, /Total — PKR 16,000/);
  assert.ok(!/Doctors said/.test(st));
  for (const ch of C.checkText(sc, st, 'main')) assert.ok(ch.ok, ch.label);

  console.log('case regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
