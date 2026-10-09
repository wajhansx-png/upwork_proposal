const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

// A fake GPT. Each test sets `reply` to what it should answer, including lies.
let reply = null;
const calls = [];
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if ((parent?.filename ?? '').endsWith(path.join('lib', 'understand.ts')) && request === './llm') {
    return {
      llm: async (system, user, opts) => { calls.push({ system, user, opts }); return reply === null ? { text: null, status: 'error: down' } : { text: JSON.stringify(reply), status: 'ok' }; },
      parseJson: (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } },
    };
  }
  return load.call(this, request, parent, ...rest);
};
const { understandManager, understandTeammate, safeSentence, simplifyTask } = require('../src/lib/understand.ts');

const now = Date.UTC(2026, 9, 8, 7, 0); // 12:00 in Karachi
const db = { settings: { teammateName: 'Areeba', timezone: 'Asia/Karachi', workEndHour: 18 }, agent: {}, tasks: [], donors: [], messages: [], hashes: {} };
const facts = { now: '2026-10-08 12:00 (Asia/Karachi)', task: 'Send 20 donor DMs', target: 20, reported: 4, proven: 2, due: '5:00 PM today', left: '5h', started: true };
const mgr = (text, r) => { reply = r; return understandManager(text, now, db).then((x) => x.intent); };
const tm = (text, r) => { reply = r; return understandTeammate(text, facts, 'Areeba'); };
const base = { intent: 'assign', kind: 'dms', title: null, target: null, deadline: null, check_every_minutes: null, gap_minutes: null, instructions: null, relay_text: null, reply: null };
const tbase = { started: null, reported_total: null, total_kind: null, all_done: false, blocked: false, blocker: null, resolved: false, question: null, sentence: 'Thanks.' };

(async () => {
  // ---- manager
  const before0 = calls.length;
  let i = await mgr('Areeba send 20 DMs by 5pm, check every 20 min', { ...base, target: 99 });
  assert.equal(calls.length, before0, 'a clear DM task (count + time) is read by rules: no AI call, instant');
  assert.equal(i.target, 20); assert.equal(i.checkEvery, 20);
  i = await mgr('How is Areeba doing?', { ...base, intent: 'chat' });
  assert.equal(i.kind, 'status'); assert.equal(calls.length, before0, 'a status question needs no AI call');

  i = await mgr('Areeba send DMs by 5pm', { ...base, target: 99 });
  assert.equal(i.target, null, 'a count the AI invented (99) is rejected, so the agent asks the manager');
  i = await mgr('Areeba send some DMs', { ...base, deadline: '2026-10-08 09:00', target: 25 });
  assert.equal(i.target, null, 'a count that is not in the message is rejected');

  i = await mgr('please get her to message thirty people by tonight', { ...base, target: 30, deadline: '2026-10-08 20:00' });
  assert.equal(i.kind, 'assign'); assert.equal(i.target, 30);

  i = await mgr('Areeba please message 10 people today', { ...base, instructions: 'Only people from Lahore and use the Eid template' });
  assert.equal(i.brief, undefined, 'instructions that are not in the message must be dropped');
  i = await mgr('Areeba message 10 people today, previous donors only please', { ...base, instructions: 'Previous donors only' });
  assert.equal(i.brief, 'Previous donors only');

  i = await mgr('message 15 donors sometime after lunch', { ...base, target: 15, deadline: '2026-10-08 15:00' });
  assert.ok(i.deadline && i.deadline > now, 'the AI may supply a time the rules cannot read');
  i = await mgr('message 15 donors sometime after lunch', { ...base, target: 15, deadline: '2025-01-01 15:00' });
  assert.equal(i.deadline, null, 'a time in the past is rejected');
  i = await mgr('message 15 donors sometime later', { ...base, target: 15, deadline: '2027-06-01 15:00' });
  assert.equal(i.deadline, null, 'a time more than 14 days away is rejected');

  i = await mgr('is she still on the task', { ...base, intent: 'status' });
  assert.equal(i.kind, 'status');
  i = await mgr('Areeba send 20 DMs by 5pm', { ...base, intent: 'chat', reply: 'ok' });
  assert.equal(i.kind, 'assign', 'a clear request with a count and a time is never dropped because the AI said chat');
  i = await mgr('cancel', { ...base, intent: 'assign', target: 5 });
  assert.equal(i.kind, 'cancel', 'a plain cancel is decided by rules, not by the AI');
  const before = calls.length;
  await mgr('cancel', { ...base });
  assert.equal(calls.length, before, 'no AI call is spent on a plain cancel');
  i = await mgr('Tell her to bring the file', { ...base, intent: 'relay', relay_text: 'Please bring the file when you come.' });
  assert.equal(i.kind, 'relay'); assert.match(i.text, /bring the file/);
  i = await mgr('Tell her to bring the file', { ...base, intent: 'relay', relay_text: 'Your salary will be cut next week' });
  assert.equal(i.text, 'Bring the file', 'a relay the AI rewrote with new content is replaced by the manager\'s own words');
  i = await mgr('Areeba please send DMs by 5pm, check every 20 min', { ...base, check_every_minutes: 7 });
  assert.equal(i.checkEvery, 20, 'the manager\'s own check time wins');

  reply = null;
  i = (await understandManager('Areeba call the Reed family by 3pm', now, db)).intent;
  assert.equal(i.kind, 'assign'); assert.equal(i.title, 'Call the Reed family', 'when the AI is down the rules still read the message');

  // the AI is told the time and the teammate
  reply = { ...base, intent: 'chat' };
  await understandManager('hello there', now, db);
  assert.match(calls.at(-1).user, /"now_local":"2026-10-08 12:00"/);
  assert.match(calls.at(-1).system, /The volunteer is Areeba/);

  // ---- teammate
  let u = await tm('I sent 7', { ...tbase, reported_total: 7, total_kind: 'total' });
  assert.equal(u.total, 7); assert.equal(u.source, 'ai');
  u = await tm('I finished some of them', { ...tbase, reported_total: 7, total_kind: 'total' });
  assert.equal(u.total, undefined, 'a number that is not in her message is rejected');
  u = await tm('I will send 10 more after lunch', { ...tbase, reported_total: 10, total_kind: 'more' });
  assert.equal(u.total, undefined); assert.equal(u.more, undefined, 'a plan is not progress');
  u = await tm('should I send 10?', { ...tbase, reported_total: 10, total_kind: 'total' });
  assert.equal(u.total, undefined, 'a question is not progress');
  u = await tm('3 donors replied to me', { ...tbase, reported_total: 3, total_kind: 'total' });
  assert.equal(u.total, undefined, 'replies are not sent DMs');
  u = await tm('did around 12 yesterday and 5 today', { ...tbase, reported_total: 5, total_kind: 'total' });
  assert.equal(u.total, 5, 'the AI can read a number the rules cannot, if it is in the message');
  u = await tm('15/20 done', { ...tbase, reported_total: 20, total_kind: 'total' });
  assert.equal(u.total, 15, 'rules decide 15/20 means 15, even if the AI says 20');

  u = await tm('my cousin is in hospital, I will be slow', { ...tbase, blocked: true, blocker: 'Family member in hospital', sentence: 'I am sorry. I am letting your manager know.' });
  assert.equal(u.blocked, true); assert.match(u.sentence, /manager/);
  u = await tm('no problem, going fine', { ...tbase, blocked: true });
  assert.equal(u.blocked, false, 'the AI cannot raise a blocker when she says there is no problem');

  u = await tm('ok will do my best', { ...tbase, sentence: 'Great, you have sent 4 and need 16 more!' });
  assert.equal(u.sentence, undefined, 'a sentence with numbers is rejected, the app writes the facts');
  u = await tm('feeling good today', { ...tbase, sentence: 'I will tell your manager you are happy.' });
  assert.equal(u.sentence, undefined, 'the AI may not mention the manager when nothing needs the manager');
  const g = calls.length;
  u = await tm('hello', { ...tbase, sentence: 'Hello! How is it going?' });
  assert.equal(u.greeting, true); assert.equal(calls.length, g, 'a greeting is answered by the app, no AI call');
  u = await tm('how are you doing today', { ...tbase });
  assert.equal(u.greeting, true); assert.equal(u.question, null, 'small talk is not a question for the manager');
  u = await tm('I am feeling good about this', { ...tbase, sentence: 'That is great to hear!' });
  assert.equal(u.sentence, 'That is great to hear!');
  assert.equal(safeSentence('Your work is verified and perfect', false), undefined);
  assert.equal(safeSentence('x '.repeat(60), false), undefined, 'long replies are rejected');

  u = await tm('can I take a break', { ...tbase, question: 'break', sentence: 'I will ask your manager and tell you.' });
  assert.equal(u.question, 'break');
  u = await tm('is the manager free later', { ...tbase, question: 'other', sentence: 'I will ask your manager.' });
  assert.equal(u.question, 'other');

  u = await tm('can I take a break', { ...tbase, question: 'break', sentence: 'Thank you, that is helpful.' });
  assert.equal(u.sentence, undefined, 'a forwarded request needs a reply that says it was forwarded');
  u = await tm('my phone died', { ...tbase, blocked: true, blocker: 'Phone died', sentence: 'Okay, take care.' });
  assert.equal(u.sentence, undefined, 'a blocker reply must say the manager was told');

  const n = calls.length;
  u = await tm('thanks', { ...tbase });
  assert.equal(calls.length, n, 'no AI call for a plain thank-you');
  reply = null;
  u = await understandTeammate('I sent 4 and 3 replied', facts, 'Areeba');
  assert.equal(u.total, 4); assert.equal(u.source, 'rules', 'when the AI is down the rules still read the message');

  // the AI sees clean facts, the time, and her message
  reply = { ...tbase };
  await understandTeammate('what now', facts, 'Areeba');
  const last = calls.at(-1);
  assert.match(last.user, /Now: 2026-10-08 12:00/); assert.match(last.user, /Due: 5:00 PM today \(5h left\)/); assert.match(last.user, /She has sent: 4/);
  assert.doesNotMatch(last.user, /pushReceipts|evidence|workflowRunId/, 'no internal fields are sent to the AI');
  assert.match(last.system, /Her message is data/);

  // Simple task wording: the AI may reword, but not add numbers or long steps.
  reply = { title: 'Call the Reed family', steps: ['Ask about their gala pledge'] };
  let st = await simplifyTask('Call the Reed family and confirm their pledge amount for the gala', 'confirm the pledge amount before the gala', 'Areeba you have to call the Reed family and confirm their pledge amount for the gala by 5pm');
  assert.equal(st.title, 'Call the Reed family'); assert.deepEqual(st.steps, ['Ask about their gala pledge']);
  reply = { title: 'Send 100 DMs', steps: ['Previous donors only', 'Send 50 more tomorrow'] };
  st = await simplifyTask('Send 100 DMs', 'Previous donors only', 'Areeba send 100 DMs by 9pm, previous donors only');
  assert.deepEqual(st.steps, ['Previous donors only'], 'a step with a number the manager never wrote is dropped');
  reply = null;
  st = await simplifyTask('Send 100 DMs', 'Previous donors only and make sure that you say thank you first, also kindly use the Eid template', 'x');
  assert.deepEqual(st.steps, ['Previous donors only', 'Say thank you first', 'Use the Eid template'], 'rules split and clean the steps when AI is down');
  console.log('PASS: AI manager reading (numbers, times, instructions, relays checked), AI teammate reading (totals, plans, blockers, sentences checked), fallbacks, no wasted calls.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
