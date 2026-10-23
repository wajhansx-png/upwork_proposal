// Case Brain: the manager's rules for LEFT / 20 MIN / DRY / DONE, people maths, angles, hadiths, style.
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
  if ((from.endsWith(path.join('lib', 'brain.ts')) || from.endsWith(path.join('lib', 'brain-read.ts')) || from.endsWith(path.join('lib', 'brain-case.ts')) || from.endsWith(path.join('lib', 'case.ts'))) && request === './llm')
    return { llm: async () => ({ text: typeof aiReply === 'function' ? aiReply() : aiReply, status: 'ok' }), parseJson: (t) => { try { return JSON.parse(t); } catch { return null; } } };
  return load.call(this, request, parent, ...rest);
};
const B = require('../src/lib/brain.ts');
const R = require('../src/lib/brain-read.ts');

const FACTS = ['Fluid is filling his brain', 'His head is swollen', 'Both his kidneys are badly swollen', 'He has a hernia', 'His blood was so weak he needed a transfusion'];
const fresh = () => B.newBrain({ name: 'Yousuf', age: 2, gender: 'm', total: 70000, facts: [...FACTS] });
const HOUR = 3600000;
const T0 = Date.parse('2026-10-23T14:00:00Z');
const BAD = /\b(dying|life-threatening|extreme pain|critical|last chance|deadline|kindly|generous)\b/i;

function checkStyle(text, left) {
  assert.ok(text.endsWith(B.ENDING), 'always ends with the pay lines');
  assert.ok(!BAD.test(text), `no banned words: ${text}`);
  const first = text.split('\n')[0];
  assert.match(first, /\*/, 'first line bold');
  assert.ok(!/fluid is (pressing|filling)/i.test(first), 'never the tired first line');
  const bold = (text.match(/\*[^*\n]+\*/g) ?? []).length;
  assert.ok(bold >= 1 && bold <= 3, `2-3 bold parts, got ${bold}: ${text}`);
  const lines = text.split('\n').filter((l) => l.trim()).length;
  assert.ok(lines >= 4 && lines <= 10, `short message, got ${lines} lines`);
  if (left !== undefined && !/complete/.test(text)) {
    const p2 = Math.ceil(left / 2000), p1 = Math.ceil(left / 1000);
    assert.ok(text.includes(`${p2} `) && text.includes(`${p1} at Rs. 1,000`), `people maths ${p2}/${p1} in: ${text}`);
    assert.ok(/\byou\b/i.test(text.replace(/^.*\n/, '')), 'a "you" line: ' + text);
  }
  for (const m of text.matchAll(/"([^"]+)"/g)) assert.ok(B.HADITHS.some((h) => h.includes(m[1])), `hadith exact: ${m[1]}`);
}

(async () => {
  // 1. Commands are read the way he types them.
  assert.deepEqual(B.parseCommand('LEFT 44000'), { kind: 'left', amount: 44000 });
  assert.deepEqual(B.parseCommand('left 44,000'), { kind: 'left', amount: 44000 });
  assert.deepEqual(B.parseCommand('44k'), { kind: 'left', amount: 44000 });
  assert.deepEqual(B.parseCommand('20 MIN'), { kind: 'tick' });
  assert.deepEqual(B.parseCommand('20min'), { kind: 'tick' });
  assert.deepEqual(B.parseCommand('DRY'), { kind: 'dry' });
  assert.deepEqual(B.parseCommand('No donations'), { kind: 'dry' });
  assert.deepEqual(B.parseCommand('20 minutes passed'), { kind: 'tick' });
  assert.deepEqual(B.parseCommand('update group'), { kind: 'tick' });
  assert.deepEqual(B.parseCommand('done'), { kind: 'done' });
  assert.equal(B.parseCommand('hello'), null);
  assert.deepEqual(B.people(44000), { p2: 22, p1: 44 });
  assert.deepEqual(B.people(43500), { p2: 22, p1: 44 }, 'rounded up');
  assert.deepEqual(B.people(1), { p2: 1, p1: 1 });

  // 2. LEFT rules (AI off: the ready lines in his style).
  aiReply = null;
  let b = fresh();
  let r = await B.runCommand(b, { kind: 'tick' }, T0);
  assert.equal(r.reply, 'Send me LEFT [amount] first.');
  r = await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  assert.equal(r.outputs.length, 1);
  assert.equal(r.outputs[0].kind, 'update');
  assert.match(r.outputs[0].text, /^\*ONLY Rs\. 44,000 Remaining\.\*/);
  assert.match(r.outputs[0].do, /GiveLife Foundation with @all/);
  checkStyle(r.outputs[0].text, 44000);
  r = await B.runCommand(b, { kind: 'left', amount: 43000 }, T0 + 600000);
  assert.match(r.reply, /^Saved\. Wait\./, 'down 1,000: wait');
  assert.equal(r.outputs.length, 0);
  r = await B.runCommand(b, { kind: 'left', amount: 42000 }, T0 + 1200000);
  assert.equal(r.outputs[0]?.kind, 'update', 'down 2,000 since the last UPDATE (not since the last number): update');
  assert.match(r.outputs[0].text, /42,000/);
  checkStyle(r.outputs[0].text, 42000);
  r = await B.runCommand(b, { kind: 'left', amount: 45000 }, T0 + 1300000);
  assert.equal(r.reply, 'Amount went up, please check.');
  assert.equal(b.left, 42000, 'a higher amount is not saved');
  r = await B.runCommand(b, { kind: 'left', amount: 42000 }, T0 + 1400000);
  assert.match(r.reply, /Saved\. Wait/);
  r = await B.runCommand(b, { kind: 'left', amount: 40500 }, T0 + 1400000 + 2 * HOUR);
  assert.equal(r.outputs[0]?.kind, 'update', 'down 1,500 after 2 quiet hours: update');
  b = fresh();
  await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  r = await B.runCommand(b, { kind: 'left', amount: 42500 }, T0 + HOUR);
  assert.match(r.reply, /Saved\. Wait/, 'down 1,500 after only 1 hour: wait');

  // 3. 20 MIN: a new angle every time, all 10 before any repeats, never the same text twice.
  b = fresh();
  await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  const seen = new Set();
  const angles = [];
  for (let i = 0; i < 12; i++) {
    r = await B.runCommand(b, { kind: 'tick' }, T0 + (i + 1) * 1200000);
    const o = r.outputs[0];
    assert.equal(o.kind, 'short');
    checkStyle(o.text, 44000);
    assert.ok(!seen.has(o.text), `never repeat a message (#${i + 1})`);
    seen.add(o.text);
    angles.push(o.angle);
  }
  assert.equal(new Set(angles.slice(0, 9)).size, 9, 'a new angle each time (UPDATE used one already)');
  assert.ok(angles.includes('hadith'));
  const hadithMsg = b.history.find((h) => h.angle === 'hadith').text;
  assert.ok(B.HADITHS.some((h) => hadithMsg.includes(h)), 'hadith copied exactly');

  // 4. DRY: two messages, main is stronger, groups have a hadith, and the reminders.
  r = await B.runCommand(b, { kind: 'dry' }, T0 + 20 * HOUR);
  assert.deepEqual(r.outputs.map((o) => o.kind), ['dry-main', 'dry-groups']);
  assert.match(r.outputs[0].do, /DM new people who saw the message, and ask donors to share/);
  assert.match(r.outputs[1].do, /Upwork Community 2026 and Fiverr Course 2026/);
  assert.ok(B.HADITHS.some((h) => r.outputs[1].text.includes(h)), 'freelancer message has a hadith');
  assert.notEqual(r.outputs[0].text, r.outputs[1].text);
  for (const o of r.outputs) checkStyle(o.text, 44000);

  // 4b. "No donations" gets more emotional with every press; money coming resets it.
  {
    const d = fresh();
    await B.runCommand(d, { kind: 'left', amount: 44000 }, T0);
    const firsts = [];
    for (let lv = 1; lv <= 5; lv++) {
      const rr = await B.runCommand(d, { kind: 'dry' }, T0 + lv * HOUR);
      assert.match(rr.outputs[0].do, new RegExp(`level ${lv}`));
      for (const o of rr.outputs) checkStyle(o.text, 44000);
      firsts.push(rr.outputs[0].text.split('\n')[0]);
    }
    assert.match(firsts[1], /donations have stopped/i, 'level 2');
    assert.match(firsts[2], /don't scroll past/i, 'level 3');
    assert.match(firsts[3], /one more time/i, 'level 4');
    assert.equal(new Set(firsts.slice(0, 4)).size, 4, 'each level is different');
    assert.ok(d.history.filter((h) => h.kind === 'dry-main').at(3).text.includes(B.HADITHS[2]), 'level 4 has the mercy hadith');
    await B.runCommand(d, { kind: 'left', amount: 42000 }, T0 + 6 * HOUR);
    const again = await B.runCommand(d, { kind: 'dry' }, T0 + 7 * HOUR);
    assert.match(again.outputs[0].do, /level 1/, 'money came: back to level 1');
  }

  // 5. DONE: his complete message, then nothing more.
  r = await B.runCommand(b, { kind: 'done' }, T0 + 21 * HOUR);
  assert.equal(r.outputs[0].text, "*Alhamdulillah! Yousuf's case is complete.* 🤲\nJazakAllah Khair to every donor. Proof coming soon.\n— GiveLife Foundation");
  r = await B.runCommand(b, { kind: 'tick' }, T0 + 22 * HOUR);
  assert.match(r.reply, /complete/);
  b = fresh();
  await B.runCommand(b, { kind: 'left', amount: 4000 }, T0);
  r = await B.runCommand(b, { kind: 'left', amount: 0 }, T0 + HOUR);
  assert.equal(r.outputs[0].kind, 'done', 'Rs. 0 left = complete');

  // 6. The AI writes the heart lines; bad ones are thrown away.
  const ai = (first, line) => JSON.stringify({ first, line });
  for (const [first, line, why] of [
    ['Yousuf is dying slowly.', 'Help him.', 'banned word'],
    ['Yousuf needs surgery tonight.', 'Help now.', 'medical word not in the facts'],
    ['Only 5 people can save Yousuf.', 'Be one.', 'made-up number'],
    ['Fluid is filling his brain right now.', 'Please help.', 'tired opener'],
    ['Yousuf has cancer.', 'Help.', 'new medical fact'],
  ]) {
    b = fresh();
    aiReply = ai(first, line);
    r = await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
    assert.ok(!r.outputs[0].text.includes(first), `AI line dropped (${why})`);
    checkStyle(r.outputs[0].text, 44000);
  }
  b = fresh();
  aiReply = ai('Yousuf is only 2 and his small body is so tired.', 'His head is swollen, and he still smiles at his mother.');
  r = await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  assert.ok(r.outputs[0].text.includes('Yousuf is only 2 and his small body is so tired.'), 'a good AI line is used');
  checkStyle(r.outputs[0].text, 44000);
  b.noAi = true;
  r = await B.runCommand(b, { kind: 'tick' }, T0 + 600000);
  assert.ok(!r.outputs[0].text.includes('small body is so tired'), 'AI off: only ready lines');
  b.noAi = false;
  aiReply = 'not json';
  r = await B.runCommand(b, { kind: 'tick' }, T0 + 1200000);
  checkStyle(r.outputs[0].text, 44000);

  // 7. Paste the whole post: name, age, boy/girl, total and facts are read; money/pay/ask lines are not facts.
  const YOUSUF = "Little Yousuf is only 2 years old & fluid is filling inside his brain.💔\n\nHis both kidneys are badly swollen because urine goes back into them. He has a hernia on both sides, and his blood became so weak he needed a transfusion.💔\n\nHe needs specialist treatment, hospital care, multiple surgeries for his treatment\n\n🚨 Rs. 70,000 needed.\n\n- 🤲 Just 35 kind people donating Rs. 2,000 can save Yousaf.\n\nPlease don't think someone else will help.\n\n📲 03097458815 — Easypaisa / JazzCash\n👤 Wajdan Khan — GiveLife Foundation";
  aiReply = null;
  let rd = await R.readCase(YOUSUF);
  assert.equal(rd.name, 'Yousuf');
  assert.equal(rd.age, 2);
  assert.equal(rd.gender, 'm');
  assert.equal(rd.total, 70000);
  assert.deepEqual(rd.facts, ['Fluid is filling inside his brain', 'His both kidneys are badly swollen because urine goes back into them', 'He has a hernia on both sides', 'His blood became so weak he needed a transfusion', 'He needs specialist treatment, hospital care, multiple surgeries for his treatment']);
  assert.deepEqual(rd.missing, []);
  rd = R.readByRules("*Helpless Ayesha (8 months) cannot breathe on her own.* 💔\n\nShe was born with a hole in her heart. Doctors at Children Hospital Lahore said she needs surgery.\n\nRs. 1.5 lakh needed. 50k collected.\n\n🤲 Just 50 kind people donating 2,000 can save her.\n📲 03097458815");
  assert.equal(rd.name, 'Ayesha');
  assert.equal(rd.ageLabel, '8 months');
  assert.equal(rd.gender, 'f');
  assert.equal(rd.total, 150000, 'lakh read, the 50k collected and the 2,000 ask are not the total');
  assert.ok(!rd.facts.some((f) => /lakh|collected|2,000/.test(f)));
  rd = R.readByRules("Ahmed's father passed away last week. The family has no ration and rent is due.\n35,000 required for ration and rent.\n03097458815 Easypaisa");
  assert.equal(rd.name, 'Ahmed', 'not "Passed"');
  assert.equal(rd.total, 35000);
  rd = R.readByRules('Please help. Send money to 03097458815.');
  assert.deepEqual(rd.missing.sort(), ['facts', 'name', 'total'], 'nothing guessed');
  // AI facts must use the words of the post; invented ones are dropped, a wrong total is ignored.
  aiReply = JSON.stringify({ name: 'Yousuf', age: 2, gender: 'm', total: 90000, facts: ['Fluid is filling inside his brain', 'He has cancer', 'His head is swollen and he cannot see', 'Both his kidneys are badly swollen'] });
  rd = await R.readCase(YOUSUF);
  assert.equal(rd.total, 70000, 'an amount not in the post is ignored');
  assert.ok(!rd.facts.some((f) => /cancer|cannot see/.test(f)), 'invented facts dropped');
  assert.ok(rd.facts.includes('Fluid is filling inside his brain'));
  aiReply = null;
  // The post is the allowed vocabulary: "surgeries" is in the post, "cancer" is not.
  const pb = B.newBrain({ name: 'Yousuf', age: 2, gender: 'm', total: 70000, facts: rd.facts, source: YOUSUF });
  assert.deepEqual(B.lineProblems('He needs surgeries and hospital care.', pb, 70000), []);
  assert.ok(B.lineProblems('He has cancer.', pb, 70000).length);
  const baby = B.newBrain({ name: 'Ayesha', ageLabel: '8 months', gender: 'f', total: 150000, facts: ['She was born with a hole in her heart'] });
  r = await B.runCommand(baby, { kind: 'left', amount: 100000 }, T0);
  for (let i = 0; i < 10; i++) { r = await B.runCommand(baby, { kind: 'tick' }, T0 + (i + 1) * 1200000); checkStyle(r.outputs[0].text, 100000); }
  assert.ok(baby.history.some((h) => /8-month-old baby|8 months old/.test(h.text)), 'months are written right');
  assert.ok(!baby.history.some((h) => /\bHe\b|\bhis\b/.test(h.text)), 'a girl is "she/her"');

  // 8. The brain starts by itself from the saved case: his own post, or a case made with the form.
  {
    const C = require('../src/lib/brain-case.ts');
    aiReply = null;
    const own = { id: 'c1', status: 'open', createdAt: '', hook: '', story: '', verse: 0, by: 'rules', posts: [], ownText: YOUSUF, facts: { type: 'child', name: 'Yousuf', gender: 'm', age: 2, problem: 'x', proof: '', amountLeft: 70000, askAmount: 2000 } };
    const bb = await C.brainFromCase(own, T0);
    assert.equal(bb.caseId, 'c1');
    assert.equal(bb.name, 'Yousuf');
    assert.equal(bb.left, 70000, 'no amount to type: the saved amount is used');
    assert.equal(bb.facts[0], 'Fluid is filling inside his brain');
    assert.equal(C.casePost(own), YOUSUF, 'the first card is his own post, word for word');
    const rr = await B.runCommand(bb, { kind: 'tick' }, T0 + 1200000);
    checkStyle(rr.outputs[0].text, 70000);
    const form = { ...own, ownText: undefined, facts: { type: 'child', name: 'Affan', gender: 'm', age: 7, problem: 'bleeding inside his knee and hand', illness: 'Hemophilia', illnessMeaning: 'blood does not clot', worstRisk: 'he can lose his leg', doctorLine: 'delay can put the leg at risk', proof: 'Aga Khan lab report', amountLeft: 26000, askAmount: 2000 } };
    const fb = await C.brainFromCase(form, T0);
    assert.deepEqual(fb.facts, ['Affan is bleeding inside his knee and hand', 'He has Hemophilia (blood does not clot)', 'Without treatment, he can lose his leg', 'Doctors said delay can put the leg at risk']);
    assert.equal(fb.left, 26000);
    assert.match(C.casePost(form), /Affan/, "the app's case post");
    // A girl's own post: she/her is counted from the post even if the saved form value says boy.
    const girl = { ...own, id: 'c3', ownText: "Helpless Ayesha (8 months) cannot breathe on her own. She was born with a hole in her heart.\n\nRs. 1.5 lakh needed.", facts: { ...own.facts, name: 'Ayesha', gender: 'm', age: undefined, amountLeft: 150000 } };
    const gb = await C.brainFromCase(girl, T0);
    assert.equal(gb.gender, 'f');
    const gr = await B.runCommand(gb, { kind: 'tick' }, T0 + 1200000);
    assert.ok(!/\bHe\b|\bhis\b/.test(gr.outputs[0].text), gr.outputs[0].text);
  }

  console.log('brain regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
