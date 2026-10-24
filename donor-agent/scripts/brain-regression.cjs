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
// What every message must respect (his real rules from the WhatsApp export).
const NEVER = /\b(kindly|generous|needy)\b/i;
const PAY = '03097458815';

/** All numbers in a message must be real: the amount, the people maths, his fixed numbers, the verse references. */
function checkNumbers(text, left, b) {
  const plain = B.plain(text);
  const { p2, p1, p15 } = B.people(left);
  const ok = new Set(['2000', '2,000', '1000', '1,000', '1500', '1,500', '10', PAY, '2', '245', '5352', '6403', '2699', String(left), B.money(left), String(p2), String(p1), String(p15), String(b.age ?? ''), String(b.total - left), B.money(b.total - left)]);
  for (const m of plain.matchAll(/\d[\d,.]*k?/g)) {
    const n = m[0].replace(/[.,]$/, '');
    if (/k$/.test(n)) assert.equal(n, B.kAmount(Number(n.slice(0, -1)) * 1000), `k amount ${n}`);
    else assert.ok(ok.has(n), `made-up number ${n} in:\n${text}`);
  }
}
function checkStyle(text, left, b) {
  assert.ok(!NEVER.test(text), `a word he never uses: ${text}`);
  for (const m of text.matchAll(/“([^”]+)”/g)) assert.ok(B.HADITHS.some((h) => h.includes(m[1])), `verse/hadith word for word: ${m[1]}`);
  if (left) checkNumbers(text, left, b);
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
  assert.deepEqual(B.people(44000), { p2: 22, p1: 44, p15: 30 });
  assert.deepEqual(B.people(43500), { p2: 22, p1: 44, p15: 29 }, 'rounded up');
  assert.equal(B.kAmount(26000), '26k');
  assert.equal(B.kAmount(17400), '17.4k');
  assert.equal(B.kAmount(800), 'Rs. 800');
  assert.equal(B.plain(B.ub('ONLY Rs. 26,000 LEFT')), 'ONLY Rs. 26,000 LEFT', 'his unicode bold, and back');
  assert.notEqual(B.ub('LEFT'), 'LEFT');

  // 2. LEFT rules (AI off): first amount = update; down 2,000 since the last UPDATE = update; less = wait.
  let b = fresh();
  b.noAi = true;
  let r = await B.runCommand(b, { kind: 'tick' }, T0);
  assert.equal(r.reply, 'Send me LEFT [amount] first.');
  r = await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  assert.equal(r.outputs.length, 1);
  assert.equal(r.outputs[0].kind, 'update');
  assert.match(r.outputs[0].do, /GiveLife Foundation with @all/);
  checkStyle(r.outputs[0].text, 44000, b);
  r = await B.runCommand(b, { kind: 'left', amount: 43000 }, T0 + 60000);
  assert.match(r.reply, /^Saved\. Wait\./, 'down 1,000: wait');
  assert.equal(r.outputs.length, 0);
  r = await B.runCommand(b, { kind: 'left', amount: 42000 }, T0 + 120000);
  assert.equal(r.outputs[0]?.kind, 'update', 'down 2,000 since the last UPDATE (not since the last number): update');
  assert.ok(B.plain(r.outputs[0].text).includes('42') && B.plain(r.outputs[0].text).includes('21'), 'new amount and people');
  checkStyle(r.outputs[0].text, 42000, b);
  r = await B.runCommand(b, { kind: 'left', amount: 50000 }, T0 + 180000);
  assert.equal(r.reply, 'Amount went up, please check.');
  assert.equal(b.left, 42000, 'a higher amount is not saved');
  r = await B.runCommand(b, { kind: 'left', amount: 40500 }, T0 + 240000);
  assert.match(r.reply, /Saved\. Wait/);
  r = await B.runCommand(b, { kind: 'left', amount: 40500 - 0 }, T0 + 240000 + 2 * HOUR);
  assert.match(r.reply, /Same amount/);
  r = await B.runCommand(b, { kind: 'left', amount: 40400 }, T0 + 240000 + 3 * HOUR);
  assert.equal(r.outputs[0]?.kind, 'update', 'down 1,500 after 2 quiet hours: update');
  // His four update styles rotate (Collected / Remaining appears when money came).
  const upd = b.history.filter((h) => h.kind === 'update').map((h) => B.plain(h.text));
  assert.equal(new Set(upd).size, upd.length, 'updates never repeat');
  assert.ok(upd.some((t) => /ONLY Rs\. 44,000 Remaining/.test(t)), 'his "ONLY Rs. X Remaining." style');
  assert.ok(upd.some((t) => /\d+(\.\d)?k remaining @all/.test(t)), 'his "42k remaining @all" style');
  assert.ok(upd.some((t) => /IT IS YOUR DEAL WITH ALLAH/.test(t)), 'his unicode bold update style');

  // 3. 20 minutes passed: a short push, then his full repost, in turn. Never the same text twice.
  b = fresh();
  b.noAi = true;
  await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  const seen = new Set(b.history.map((h) => h.text));
  const shorts = [];
  for (let i = 0; i < 24; i++) {
    r = await B.runCommand(b, { kind: 'tick' }, T0 + (i + 1) * 20 * 60000);
    const o = r.outputs[0];
    assert.equal(o.kind, 'short');
    assert.ok(!seen.has(o.text), `never repeat a message (#${i + 1})`);
    seen.add(o.text);
    checkStyle(o.text, 44000, b);
    shorts.push(o);
  }
  shorts.forEach((o, i) => {
    const full = o.text.includes('___________');
    assert.equal(full, i % 2 === 1, `#${i + 1}: ${i % 2 === 1 ? 'full repost' : 'short push'}`);
    if (full) {
      for (const part of ['- *Allah is giving you this chance.*', '_Allah will multiply what you give. No bank gives that return._', '⚠️ Takes only 10 seconds', B.ENDING, '- Wajdan Khan Team - GiveLife Foundation @all'])
        assert.ok(o.text.includes(part), `his repost layout has "${part}"`);
      assert.match(o.text, /_[^\n]+_💔/, 'his facts in italics with 💔');
      assert.ok(B.HADITHS.some((h) => o.text.includes(h)), 'a verse/hadith word for word');
      assert.match(B.plain(o.text), /(?<!\d)(22|30)(?!\d)/, 'people maths 22 (2,000) or 30 (1,500)');
    } else {
      assert.ok(o.text.split('\n').filter((l) => l.trim()).length <= 9, `short push is short: ${o.text}`);
    }
  });
  const angles = shorts.filter((o) => o.angle).map((o) => o.angle);
  assert.equal(new Set(angles.slice(0, 7)).size, 7, 'a new hook each full repost');
  assert.ok(!angles.includes('notMoney'), 'no "keeps his LEG" hook without a risk word');
  assert.ok(shorts.some((o) => /Please send a screenshot/.test(o.text)), 'his screenshot request appears');

  // A risk word from the form unlocks his "keeps his LEG or loses it" hook; a girl is she/her.
  b = B.newBrain({ name: 'Affan', age: 9, gender: 'm', total: 50000, risk: 'leg', noAi: true, facts: ['Affan is bleeding inside his knee and hand'] });
  await B.runCommand(b, { kind: 'left', amount: 26000 }, T0);
  for (let i = 0; i < 24; i++) await B.runCommand(b, { kind: 'tick' }, T0 + (i + 1) * 60000);
  assert.ok(b.history.some((h) => h.text.includes('keeps his LEG or loses it. You decide.')), 'his LEG hook');
  const g = B.newBrain({ name: 'Ayesha', ageLabel: '8 months', gender: 'f', total: 80000, noAi: true, facts: ['She has a hole in her heart'] });
  await B.runCommand(g, { kind: 'left', amount: 80000 }, T0);
  for (let i = 0; i < 10; i++) await B.runCommand(g, { kind: 'tick' }, T0 + (i + 1) * 60000);
  for (let i = 0; i < 5; i++) await B.runCommand(g, { kind: 'dry' }, T0 + (20 + i) * 60000);
  for (const h of g.history) assert.ok(!/\b(He|he|his|him)\b/.test(B.HADITHS.reduce((t, q) => t.replace(q, ''), B.plain(h.text))), `a girl is she/her (verses aside): ${h.text}`);
  assert.ok(g.history.some((h) => /little baby/.test(h.text)), 'a baby is "baby"');

  // 4. No donations: his escalation, one step stronger each press; money coming resets it.
  b = fresh();
  b.noAi = true;
  await B.runCommand(b, { kind: 'left', amount: 41000 }, T0);
  const steps = [];
  for (let lv = 1; lv <= 5; lv++) {
    r = await B.runCommand(b, { kind: 'dry' }, T0 + lv * 20 * 60000);
    assert.deepEqual(r.outputs.map((o) => o.kind), ['dry-main', 'dry-groups']);
    assert.match(r.outputs[0].do, new RegExp(`level ${lv}`));
    assert.match(r.outputs[0].do, /tag your donors/);
    assert.match(r.outputs[1].do, /Upwork Community 2026 and Fiverr Course 2026/);
    assert.ok(r.outputs[1].text.includes('___________') && !r.outputs[1].text.endsWith('@all'), 'groups get his full repost, no @all');
    r.outputs.forEach((o) => checkStyle(o.text, 41000, b));
    steps.push(B.plain(r.outputs[0].text));
  }
  assert.match(steps[0], /^Sadly, no donations yet/);
  assert.match(steps[1], /^💔 Sadly, no one has put part yet/);
  assert.match(steps[2], /PLEASE DON'T THINK SOMEONE ELSE WILL HELP/);
  assert.match(steps[3], /WE ARE MUSLIMS — IT'S HEARTBREAKING THAT YOUSUF/);
  assert.match(steps[4], /Sadly, no one has come forward/);
  r = await B.runCommand(b, { kind: 'left', amount: 39000 }, T0 + 7 * HOUR);
  r = await B.runCommand(b, { kind: 'dry' }, T0 + 8 * HOUR);
  assert.match(r.outputs[0].do, /level 1/, 'money came: back to level 1');

  // 5. Case complete: his exact closing message, by kind of case.
  r = await B.runCommand(b, { kind: 'done' }, T0 + 9 * HOUR);
  assert.equal(B.plain(r.outputs[0].text), "YOUSUF’S CASE IS COMPLETE. 🤲\n\nAlhamdulillah, with your help we completed the full treatment amount.\n\nJazakAllah Khair to everyone who donated, shared, made dua, or helped in any way.\n\nMay Allah accept it from you, multiply your reward, and bring complete shifa to Yousuf. ❤️\n\nProof and updates will be shared.\n\n— GiveLife Foundation @all");
  r = await B.runCommand(b, { kind: 'tick' }, T0 + 10 * HOUR);
  assert.match(r.reply, /complete/);
  const o = B.newBrain({ name: 'these orphans', total: 40000, type: 'orphans', facts: ['Their father has passed away'] });
  assert.match(B.plain(B.writeDone(o, T0).text), /^🌿 Alhamdulillah! This case is now closed\./);
  const d = B.newBrain({ name: 'Sohail', total: 40000, type: 'death', facts: ['Sohail was a poor daily-wage worker'] });
  assert.match(B.writeDone(d, T0).text, /Janazah/);
  // The verse follows the kind of case: orphans get the orphan hadith, a Janazah the kafan hadith.
  o.noAi = true; d.noAi = true;
  await B.runCommand(o, { kind: 'left', amount: 40000 }, T0);
  await B.runCommand(o, { kind: 'tick' }, T0 + 1);
  await B.runCommand(o, { kind: 'tick' }, T0 + 2);
  assert.ok(o.history.some((h) => h.text.includes(B.QUOTES.orphan)), 'orphan hadith');
  await B.runCommand(d, { kind: 'left', amount: 40000 }, T0);
  await B.runCommand(d, { kind: 'tick' }, T0 + 1);
  await B.runCommand(d, { kind: 'tick' }, T0 + 2);
  assert.ok(d.history.some((h) => h.text.includes(B.QUOTES.kafan)), 'kafan hadith');
  b = fresh();
  b.noAi = true;
  r = await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  r = await B.runCommand(b, { kind: 'left', amount: 0 }, T0 + 60000);
  assert.equal(r.outputs[0].kind, 'done', 'Rs. 0 left = complete');
  // Fajr (4-6 am Pakistan time): his Fajr reminder.
  b = fresh();
  b.noAi = true;
  await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  r = await B.runCommand(b, { kind: 'tick' }, Date.parse('2026-10-24T23:30:00Z'));
  assert.match(r.outputs[0].text, /^Fajr time reminder/);

  // 6. The AI writes the bold hook of a full repost; bad ones are thrown away.
  const ai = (hook) => JSON.stringify({ hook });
  for (const [line, why] of [
    ['Yousuf needs surgery tonight and you can help him', 'medical word not in the facts'],
    ['Only 5 people can save Yousuf today', 'made-up number'],
    ['Kindly help Yousuf today', 'a word he never uses'],
    ['Yousuf has cancer and needs you now', 'new medical fact'],
  ]) {
    b = fresh();
    aiReply = ai(line);
    await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
    await B.runCommand(b, { kind: 'tick' }, T0 + 1);
    r = await B.runCommand(b, { kind: 'tick' }, T0 + 2);
    assert.ok(!r.outputs[0].text.includes(line), `AI hook dropped (${why})`);
    checkStyle(r.outputs[0].text, 44000, b);
  }
  b = fresh();
  aiReply = ai('Yousuf is only 2 and his small body is so tired');
  await B.runCommand(b, { kind: 'left', amount: 44000 }, T0);
  await B.runCommand(b, { kind: 'tick' }, T0 + 1);
  r = await B.runCommand(b, { kind: 'tick' }, T0 + 2);
  assert.ok(r.outputs[0].text.startsWith('*💔 Yousuf is only 2 and his small body is so tired*'), 'a good AI hook is used, bold with 💔');
  b.noAi = true;
  r = await B.runCommand(b, { kind: 'tick' }, T0 + 3);
  r = await B.runCommand(b, { kind: 'tick' }, T0 + 4);
  assert.ok(!r.outputs[0].text.includes('small body is so tired'), 'AI off: only his ready hooks');
  b.noAi = false;
  aiReply = 'not json';
  await B.runCommand(b, { kind: 'tick' }, T0 + 5);
  r = await B.runCommand(b, { kind: 'tick' }, T0 + 6);
  checkStyle(r.outputs[0].text, 44000, b);
  assert.ok(r.outputs[0].text.includes('___________'), 'AI broken: his ready repost');

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
  for (let i = 0; i < 10; i++) { r = await B.runCommand(baby, { kind: 'tick' }, T0 + (i + 1) * 1200000); checkStyle(r.outputs[0].text, 100000, baby); }
  assert.ok(baby.history.some((h) => /\bbaby\b/.test(h.text)) && !baby.history.some((h) => /8-year/.test(h.text)), 'a baby is called baby, never 8-year-old');
  assert.ok(!baby.history.some((h) => /\bHe\b|\bhis\b/.test(B.HADITHS.reduce((t, q) => t.replace(q, ''), B.plain(h.text)))), 'a girl is "she/her" (verses aside)');

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
    checkStyle(rr.outputs[0].text, 70000, bb);
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
