const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const nlp = require('../src/lib/nlp.ts');

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL ${label}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); }
};

// ---- numbers
check('numbers: words', nlp.numbersIn('I sent twenty five and ten more'), [25, 10]);
check('numbers: hundred', nlp.numbersIn('a hundred dms'), [100]);
check('numbers: times are not counts', nlp.numbersIn('send 20 by 5pm or 5:30 or 6 p.m.'), [20]);
check('numbers: commas', nlp.numbersIn('1,200 donors'), [1200]);

// ---- progress reports: [text, total, more, all]
const reports = [
  ['I sent 4', 4], ['sent 4 so far', 4], ['4 done', 4], ['Done 7 messages', 7], ['I have sent 12 DMs till now', 12], ['completed 8', 8],
  ['I sent 4 and 3 replied', 4], ['5 sent, 2 replied, no problem', 5], ['I have sent five', 5], ['sent ten dms', 10], ['I sent twenty five', 25],
  ['total 15 now', 15], ['15/20 done', 15], ['15 out of 20 sent', 15], ['sent 20 out of 20', 20], ['I did 6 messages', 6], ['6 dms sent', 6],
  ['I have done 9 till now', 9], ['so far 11', 11], ['14 messages completed', 14], ['messaged 3 donors', 3], ['contacted 8 people', 8],
  ['2 sent', 2], ['sent: 13', 13], ['Sent 0', 0], ['DMs sent: 17', 17], ['sent 7 dms in the last 10 minutes', 7], ['I have finished 10 messages', 10],
  // not reports
  ['I will send 10 more', null], ['I can do 5 more', null], ['should I send 10?', null], ["I haven't sent 4", null], ["didn't send anything", null],
  ['3 replied', null], ['2 people replied', null], ['I got a reply from 3 donors', null], ['3 donors have responded', null], ['going to send 8 now', null],
  ['I will start at 2pm', null], ['by 5pm I will be done', null], ['can I send 5 dms?', null], ['how many should I send', null], ['ok', null],
  ['it takes 5 minutes per dm', null], ['wait 10 minutes', null], ['I need 20 more donors', null],
];
for (const [t, want] of reports) check(`report: ${t}`, nlp.parseReport(t).total ?? null, want);
check('report: 3 more', nlp.parseReport('I sent 3 more').more, 3);
check('report: all done', nlp.parseReport('All done').all, true);
check('report: finished all of them', nlp.parseReport('I finished all of them').all, true);
check('report: done', nlp.parseReport('done').all, true);
check('report: not all done', nlp.parseReport('not all done yet').all ?? false, false);
check('report: will finish all', nlp.parseReport('I will finish all by 5').all ?? false, false);

// ---- started
const starts = [
  ['I started', 'started'], ['started', 'started'], ['ok starting now', 'started'], ['Yes I have started sending', 'started'], ["I'm working on it", 'started'], ['on it', 'started'],
  ['Sure, starting in 10 minutes', 'will-start'], ['I will start at 2pm', 'will-start'], ['starting soon', 'will-start'], ["I'll begin after lunch", 'will-start'], ['going to start now', 'will-start'],
  ['not yet', 'not-started'], ['I have not started', 'not-started'], ["haven't started", 'not-started'], ['not started yet', 'not-started'],
  ['when should I start?', null], ['should I start now?', null], ['ok', null], ['what is the deadline', null],
];
for (const [t, want] of starts) check(`start: ${t}`, nlp.startSignal(t), want);

// ---- blockers
const blocks = [
  ['whatsapp is not working', true], ['my phone died', true], ['I cannot send, number blocked', true], ['I am stuck', true], ['I have a problem', true],
  ['no internet', true], ['power cut here', true], ['I am sick today', true], ['my account got banned', true], ["I don't have the list", true], ['family emergency', true], ['I need help', true],
  ['no problem all good', false], ['wifi is slow but ok', false], ['no issues', false], ['all fine', false], ['not a problem', false], ['everything is ok', false],
  ['problem solved', false], ['internet is back, fixed', false], ['what is the problem?', false], ['sent 5, no problem', false], ['ok thanks', false],
];
for (const [t, want] of blocks) check(`blocked: ${t}`, nlp.blockSignal(t).blocked, want);
check('resolved: fixed', nlp.blockSignal('fixed, I can continue').resolved, true);

// ---- questions
const qs = [
  ['when is the deadline?', 'deadline'], ['what time is it due', 'deadline'], ['how much time is left?', 'deadline'],
  ['what should I do next?', 'next'], ['what now', 'next'], ['which donor first?', 'next'], ['how do I add proof?', 'next'],
  ['how many have I done?', 'progress'], ['am I behind?', 'progress'],
  ['can I take a break?', 'break'], ['I need to go for prayer', 'break'], ['can I have lunch now', 'break'],
  ['can I get more time?', 'extension'], ['I need an extension', 'extension'], ['can I finish tomorrow?', 'extension'],
  ['is it okay to use a different message?', 'other'],
  ['I sent 4', null], ['ok', null], ['thanks', null],
];
for (const [t, want] of qs) check(`question: ${t}`, nlp.questionKind(t), want);

// ---- manager messages: [text, kind]
const mgr = [
  ['Areeba send 20 DMs by 5pm', 'request'], ['Areeba must message 30 donors before 6pm, check every 15 min', 'request'], ['ask areeba to send fifty dms by 4:30pm', 'request'],
  ['Send 10 DMs to previous donors only by 3pm', 'request'], ['make areeba contact 25 people by end of day', 'request'], ['Areeba please send 40 messages in 2 hours', 'request'],
  ['I need 15 donors messaged by tonight', 'request'], ['Areeba call the Reed family by 3pm', 'request'], ['prepare the thank you list by 5pm tomorrow', 'request'],
  ['Areeba send 20 dms', 'request'], ['please message 12 people today', 'request'], ['send 8 emails by 2pm', 'request'],
  ['How is Areeba doing?', 'status'], ['what is the update', 'status'], ['is she working?', 'status'], ['any progress', 'status'], ['how many has she sent', 'status'],
  ['status', 'status'], ['update me', 'status'], ["what's the status", 'status'], ['did she start?', 'status'], ['has areeba sent anything', 'status'], ['where is she', 'status'],
  ['Areeba did not send anything yet, why?', 'status-or-chat'], ['she sent 5 messages today, ok good', 'chat'], ['areeba sent 20 dms already', 'chat'], ['thanks', 'chat'], ['hello', 'chat'], ['ok', 'chat'],
  ['cancel', 'cancel'], ['cancel the task', 'cancel'], ['stop', 'cancel'], ['never mind', 'cancel'], ['discard the draft', 'cancel'],
  ['confirm', 'confirm'], ['approved', 'confirm'], ['looks good', 'confirm'],
  ['Tell her to send me the report', 'relay'], ['remind areeba about the 3pm call', 'relay'], ['ask her if she needs help', 'relay'], ['let her know I am on leave tomorrow', 'relay'],
];
const kind = (t) => { const p = nlp.parseManager(t, 'Areeba'); return p.isCancel ? 'cancel' : p.isConfirm ? 'confirm' : p.relay ? 'relay' : p.isStatus ? 'status' : p.isRequest ? 'request' : 'chat'; };
for (const [t, want] of mgr) {
  const got = kind(t);
  const ok = want === 'status-or-chat' ? ['status', 'chat'].includes(got) : got === want;
  if (!ok) { bad++; console.log(`FAIL manager: ${t}\n   got ${got} want ${want}`); }
}
check('relay text: tell', nlp.parseManager('Tell her to send me the report', 'Areeba').relay, 'Send me the report');
check('relay text: remind', nlp.parseManager('remind areeba about the 3pm call', 'Areeba').relay, 'Reminder: the 3pm call');
check('relay text: ask', nlp.parseManager('ask her if she needs help', 'Areeba').relay, 'She needs help?');

// ---- instructions and titles
check('instructions: previous donors', nlp.extractInstructions('Send 10 DMs to previous donors only by 3pm', 'Areeba'), 'Previous donors only');
check('instructions: none', nlp.extractInstructions('Areeba send 20 DMs by 5pm', 'Areeba'), undefined);
check('instructions: none 2', nlp.extractInstructions('Areeba please send 40 messages in 2 hours, check every 10 min', 'Areeba'), undefined);
check('instructions: avoid', nlp.extractInstructions('Areeba message 30 donors by 6pm, avoid anyone who gave in 2024', 'Areeba'), 'Avoid anyone who gave in');
check('title: call', nlp.cleanTitle('Areeba call the Reed family by 3pm', 'Areeba'), 'Call the Reed family');
check('title: prepare', nlp.cleanTitle('please prepare the thank you list by 5pm tomorrow', 'Areeba'), 'Prepare the thank you list');

if (bad) { console.log(`\n${bad} FAILED`); process.exitCode = 1; } else console.log('PASS: numbers, progress reports, started, blockers, questions, manager messages, instructions, titles.');
