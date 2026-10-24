// Changing a message with AI: rule checks, edit one line, 5 versions (bad ones dropped), regenerate (fixed lines kept).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
let answer = '{}';
let status = 'ok';
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  const real = load.call(this, name, parent, ...rest);
  if (/[\\/]llm(\.ts)?$/.test(name) || name === './llm') return { ...real, llm: async () => ({ text: status === 'ok' ? answer : null, status }) };
  return real;
};
const { editProblems, editLine, lineVersions, rewriteMessage, rewriteWithInstruction } = require('../src/lib/brain-edit.ts');

const b = { name: 'Yousuf', age: 2, gender: 'm', total: 70000, left: 44000, facts: ['Fluid is filling his brain.', 'His kidneys are swollen.'], source: 'Little Yousuf has a hernia and needed a blood transfusion.', angles: [], history: [] };
const msg = '🤲 *Rs. 44,000 left. 22 people at Rs. 2,000.*\n\n💔 He cannot tell his mother where it hurts.\n\n"Charity does not decrease wealth." (Sahih Muslim)\n\n03097458815 — Easypaisa / JazzCash\nWajdan Khan — GiveLife Foundation';

(async () => {
  // Rule checks
  assert.deepEqual(editProblems('💔 He only knows it hurts.', b, msg), []);
  assert.deepEqual(editProblems('Rs. 44,000 left, 22 people.', b, msg), []);
  assert.ok(editProblems('Only 5 people left now', b, msg).some((p) => p.includes('new number 5')));
  assert.ok(editProblems('He may need surgery', b, msg).some((p) => p.includes('surgery')));
  assert.deepEqual(editProblems('His kidneys hurt and his brain too', b, msg), [], 'words from the facts are fine');
  assert.deepEqual(editProblems('He needed a transfusion', b, msg), [], 'words from his post are fine');
  assert.ok(editProblems('He is dying', b, msg).some((p) => p.includes('banned')));
  assert.deepEqual(editProblems('', b, msg), ['empty']);

  // Edit one line: the change is returned with warnings, never blocked
  answer = JSON.stringify({ text: '💔 He cannot even say where it hurts, he can only cry.' });
  let r = await editLine(b, msg, '💔 He cannot tell his mother where it hurts.', 'make it more emotional');
  assert.equal(r.text, '💔 He cannot even say where it hurts, he can only cry.');
  assert.deepEqual(r.warnings, []);
  answer = JSON.stringify({ text: '💔 Only 3 days to save him.' });
  r = await editLine(b, msg, '💔 He cannot tell his mother where it hurts.', 'add urgency');
  assert.ok(r.warnings.length >= 1, 'a new number is warned about');

  // 5 versions: bad and duplicate ones dropped
  answer = JSON.stringify({ versions: ['💔 He can only cry.', '💔 He can only cry.', '💔 He is dying.', '💔 Only 9 people.', '💔 His mother can only watch.', '💔 He does not know why it hurts.', '💔 He waits for you.', '💔 One more fresh line.'] });
  const v = await lineVersions(b, msg, '💔 He cannot tell his mother where it hurts.');
  assert.deepEqual(v, ['💔 He can only cry.', '💔 His mother can only watch.', '💔 He does not know why it hurts.', '💔 He waits for you.', '💔 One more fresh line.']);
  answer = JSON.stringify({ versions: ['💔 He is dying.'] });
  await assert.rejects(lineVersions(b, msg, 'x'), /broke your rules/);

  // Regenerate: the fixed lines must stay word for word, numbers must not change
  const fresh = msg.replace('💔 He cannot tell his mother where it hurts.', '💔 He only knows that it hurts, and he cannot say it.');
  answer = JSON.stringify({ text: fresh });
  assert.equal(await rewriteMessage(b, msg), fresh);
  answer = JSON.stringify({ text: fresh.replace('03097458815', '03001234567') });
  await assert.rejects(rewriteMessage(b, msg), /rules/);
  answer = JSON.stringify({ text: fresh.replace('44,000', '40,000') });
  await assert.rejects(rewriteMessage(b, msg), /rules/);

  // Whole message by his instruction: strong words he asked for pass; invented facts / changed payment are warned
  const urgent = msg.replace('💔 He cannot tell his mother where it hurts.', '🚨 *This is critical. Yousuf needs help right now.*');
  answer = JSON.stringify({ text: urgent });
  let w = await rewriteWithInstruction(b, msg, 'add urgency, more dangerous');
  assert.equal(w.text, urgent);
  assert.deepEqual(w.warnings, [], 'words he asked for are not warned');
  answer = JSON.stringify({ text: msg.replace('💔 He cannot tell his mother where it hurts.', '🚨 He may need surgery in 3 days.') });
  w = await rewriteWithInstruction(b, msg, 'more dangerous');
  assert.ok(w.warnings.some((x) => x.includes('surgery')) && w.warnings.some((x) => x.includes('new number 3')), 'invented facts warned');
  answer = JSON.stringify({ text: msg.replace('03097458815 — Easypaisa / JazzCash', 'Send now') });
  w = await rewriteWithInstruction(b, msg, 'shorter');
  assert.ok(w.warnings.includes('the payment line changed'));

  // AI off / limit: a plain reason
  status = 'off';
  await assert.rejects(editLine(b, msg, 'x', 'y'), /AI is off/);
  status = 'limit';
  await assert.rejects(rewriteMessage(b, msg), /limit/);
  console.log('PASS: AI message changes (whole message by instruction, rule checks, line edit with warnings, 5 versions filtered, regenerate keeps fixed lines and numbers, AI off/limit reasons).');
})().catch((e) => { console.error(e); process.exitCode = 1; });
