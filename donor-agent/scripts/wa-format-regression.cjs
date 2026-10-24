// WhatsApp formatting: what becomes bold / italic / strike / mono / bullet, and what must stay plain text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { waFormat } = require('../src/lib/wa-format.ts');

// A compact picture of the tree, to compare in the tests: b(..) i(..) s(..) m(..) •(..) / for a line break.
const pic = (nodes) => nodes.map((n) => n.t === 'text' ? n.v : n.t === 'br' ? '/' : n.t === 'block' ? `[${n.v}]` : n.t === 'bullet' ? `•(${pic(n.c)})` : `${n.t}(${pic(n.c)})`).join('');
const eq = (text, want) => assert.equal(pic(waFormat(text)), want, JSON.stringify(text));

// The marks we use every day
eq('*bold*', 'b(bold)');
eq('_it_', 'i(it)');
eq('~gone~', 's(gone)');
eq('`code`', 'm(code)');
eq('🤲 *One meal costs Rs. 2,000. It means treatment.*', '🤲 b(One meal costs Rs. 2,000. It means treatment.)');
eq('Rs. 44,000 left. *Please help* today.', 'Rs. 44,000 left. b(Please help) today.');
eq('(*bold*)', '(b(bold))');
eq('*bold*, then _italic_!', 'b(bold), then i(italic)!');

// Nested
eq('*bold _and italic_*', 'b(bold i(and italic))');
eq('_*both*_', 'i(b(both))');

// Not formatting: spaces inside, inside words, lone marks
eq('a * not bold *', 'a * not bold *');
eq('snake_case_name', 'snake_case_name');
eq('2*3*4', '2*3*4');
eq('5 * 3 = 15', '5 * 3 = 15');
eq('**', '**');
eq('*unclosed', '*unclosed');
eq('Rs 2000*', 'Rs 2000*');
// A mark inside code is not formatted
eq('`*x*`', 'm(*x*)');

// Lines
eq('a\nb', 'a/b');
eq('a\n\nb', 'a//b');
eq('*one*\n*two*', 'b(one)/b(two)');
eq('- one\n- two', '•(one)•(two)');
eq('* one\n* two', '•(one)•(two)');
eq('intro\n- item *x*', 'intro/•(item b(x))');
eq('```\ncode *here*\n```', '[code *here*]');
eq('before\n```x```\nafter', 'before/[x]/after');

// The real case post style (hadith + pay lines)
eq('🤲 *Rs. 44,000 left.*\n\n03097458815 — Easypaisa / JazzCash', '🤲 b(Rs. 44,000 left.)//03097458815 — Easypaisa / JazzCash');
console.log('PASS: WhatsApp formatting (bold, italic, strike, mono, nested, bullets, blocks; no formatting inside words, around spaces, or with lone marks).');

// Selecting on the preview finds the raw lines (with their marks)
const { linesOf } = require('../src/lib/wa-format.ts');
const msg = '🤲 *One meal costs Rs. 2,000.*\n\n💔 Yousuf is still waiting.\n* _*Only 22 more people*_\n\n03097458815 — Easypaisa';
assert.deepEqual(linesOf(msg, 'meal costs'), { from: 0, to: 0 });
assert.deepEqual(linesOf(msg, 'Yousuf is still waiting.'), { from: 2, to: 2 });
assert.deepEqual(linesOf(msg, 'Only 22 more'), { from: 3, to: 3 });
assert.deepEqual(linesOf(msg, 'still waiting.\nOnly 22'), { from: 2, to: 3 });
assert.deepEqual(linesOf(msg, '• Only 22 more people'), { from: 3, to: 3 });
assert.equal(linesOf(msg, 'not in the message'), null);
assert.equal(linesOf(msg, '   '), null);
console.log('PASS: a selection on the preview maps to the right raw lines (marks, bullets, several lines).');
