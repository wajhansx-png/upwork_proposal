// "Manager saw your progress": shown to her only when it is true, and cheap on storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

let db;
let writes = 0;
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if ((parent?.filename ?? '').endsWith(path.join('lib', 'seen.ts')) && request === './db') return { withDb: async (fn) => { writes++; return fn(db); } };
  return load.call(this, request, parent, ...rest);
};
const { noteManagerSeen, managerSeenAt } = require('../src/lib/seen.ts');

const T0 = Date.UTC(2026, 9, 15, 4, 0);
const iso = (t) => new Date(t).toISOString();
const task = (o = {}) => ({ id: 't1', title: 'Send 40 DMs', kind: 'dms', target: 40, status: 'open', createdAt: iso(T0), deadlineAt: iso(T0 + 3 * 3600000), unanswered: 0, reportedDone: 0, ...o });
const reset = (tasks) => { db = { tasks, agent: {} }; writes = 0; };
const poll = async (at) => { db = await noteManagerSeen(structuredClone(db), at); return db; };

(async () => {
  reset([]);
  await noteManagerSeen(db, T0);
  assert.equal(writes, 0, 'no task: nothing to remember');
  assert.equal(managerSeenAt(db), null);

  reset([task()]);
  assert.equal(managerSeenAt(db), null, 'he has not looked yet: she sees nothing');
  await noteManagerSeen(db, T0);
  assert.equal(writes, 1);
  assert.equal(managerSeenAt(db), iso(T0), 'he looked: she sees when');

  // Watching for a long time writes about twice a minute, not on every 5-second refresh.
  writes = 0;
  for (let s = 5; s <= 29; s += 5) await noteManagerSeen(db, T0 + s * 1000);
  assert.equal(writes, 0, 'refreshes inside 30 seconds do not write');
  await noteManagerSeen(db, T0 + 31000);
  assert.equal(writes, 1, 'after 30 seconds it writes again');
  assert.equal(managerSeenAt(db), iso(T0 + 31000), 'and the time moves forward');

  // She adds DMs: the new number is NOT seen until he looks again.
  db.tasks[0].reportedDone = 5;
  assert.equal(managerSeenAt(db), null, 'a newer count is "not seen yet"');
  writes = 0;
  await noteManagerSeen(db, T0 + 33000);
  assert.equal(writes, 1, 'a changed count is written at once, even inside 30 seconds');
  assert.equal(managerSeenAt(db), iso(T0 + 33000), 'now he has seen the new number');

  // A different task, or a task that is not counted by DMs.
  db.tasks.push(task({ id: 't2', reportedDone: 0 }));
  assert.equal(managerSeenAt(db), null, 'a new task starts unseen');
  reset([task({ kind: 'general', target: 1 })]);
  await noteManagerSeen(db, T0);
  assert.equal(writes, 0, 'a task with no count has nothing to "see"');
  assert.equal(managerSeenAt(db), null);

  // Finished and missed tasks.
  reset([task({ status: 'done', reportedDone: 40 })]);
  await noteManagerSeen(db, T0);
  assert.equal(managerSeenAt(db), null, 'her screen shows no task, so nothing is shown');
  reset([task({ status: 'missed', reportedDone: 12 })]);
  await noteManagerSeen(db, T0);
  assert.equal(managerSeenAt(db), iso(T0), 'a missed task is on both screens');

  // The record is the exact count he saw, never a guess for the future.
  reset([task({ reportedDone: 7 })]);
  await noteManagerSeen(db, T0);
  assert.deepEqual(db.agent.managerSeen, { at: iso(T0), taskId: 't1', done: 7 });

  console.log('seen regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
