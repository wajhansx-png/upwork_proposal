// The one-minute clock must never stop silently: a follow-up that ended or vanished is replaced; a live one is left alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

let db;
const runStatus = {}; // runId -> status, or an Error to throw
let started = [];
let startFails = false;
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  const from = parent?.filename ?? '';
  if (from.endsWith(path.join('lib', 'start-followup.ts'))) {
    if (request === './db') return { readDb: async () => structuredClone(db), withDb: async (fn) => fn(db) };
    if (request === '../workflows/follow-task') return { followTask: () => undefined };
    if (request === 'workflow/api')
      return {
        start: async (_fn, args) => {
          if (startFails) throw new Error('cannot start');
          const runId = 'run' + (started.length + 1);
          started.push(args[0]);
          runStatus[runId] = 'running';
          return { runId };
        },
        getRun: (id) => ({ get status() { const s = runStatus[id]; return s instanceof Error ? Promise.reject(s) : Promise.resolve(s); } }),
      };
  }
  return load.call(this, request, parent, ...rest);
};
const { ensureFollowup } = require('../src/lib/start-followup.ts');

const NOW = Date.UTC(2026, 9, 15, 4, 0);
const iso = (t) => new Date(t).toISOString();
const task = (o = {}) => ({ id: 't1', title: 'Send 10 DMs', kind: 'dms', target: 10, status: 'open', createdAt: iso(NOW - 3600000), deadlineAt: iso(NOW + 3600000), unanswered: 0, ...o });
const reset = (tasks) => { db = { tasks }; started = []; startFails = false; for (const k of Object.keys(runStatus)) delete runStatus[k]; };

(async () => {
  console.error = () => undefined; // the failure case logs on purpose

  reset([]);
  await ensureFollowup(NOW);
  assert.equal(started.length, 0, 'no task: nothing to follow');

  reset([task({ status: 'done' })]);
  await ensureFollowup(NOW);
  assert.equal(started.length, 0, 'a finished task is not followed');

  reset([task()]);
  await ensureFollowup(NOW);
  assert.deepEqual(started, ['t1'], 'a new task gets its follow-up');
  assert.equal(db.tasks[0].workflowRunId, 'run1');
  assert.ok(db.tasks[0].workflowStartedAt);
  await ensureFollowup(NOW + 60000);
  assert.equal(started.length, 1, 'a running follow-up is left alone');

  for (const dead of ['completed', 'failed', 'cancelled']) {
    reset([task({ workflowRunId: 'old', workflowStartedAt: iso(NOW - 600000) })]);
    runStatus.old = dead;
    await ensureFollowup(NOW);
    assert.equal(started.length, 1, `a ${dead} follow-up is replaced`);
    assert.equal(db.tasks[0].workflowRunId, 'run1');
  }
  for (const live of ['pending', 'running']) {
    reset([task({ workflowRunId: 'old', workflowStartedAt: iso(NOW - 600000) })]);
    runStatus.old = live;
    await ensureFollowup(NOW);
    assert.equal(started.length, 0, `a ${live} follow-up is kept`);
  }

  // The runtime says the run does not exist: replace it at once, even if the heartbeat is fresh.
  reset([task({ workflowRunId: 'old', workflowStartedAt: iso(NOW - 3600000), lastWorkerAt: iso(NOW - 30000) })]);
  runStatus.old = Object.assign(new Error('Workflow run "old" not found'), { name: 'WorkflowRunNotFoundError' });
  await ensureFollowup(NOW);
  assert.equal(started.length, 1, 'a run that no longer exists is replaced');

  // Cannot ask the runtime: trust a fresh heartbeat, replace a silent one.
  reset([task({ workflowRunId: 'old', workflowStartedAt: iso(NOW - 3600000), lastWorkerAt: iso(NOW - 60000) })]);
  runStatus.old = new Error('network');
  await ensureFollowup(NOW);
  assert.equal(started.length, 0, 'unknown status + a heartbeat a minute ago: kept');
  reset([task({ workflowRunId: 'old', workflowStartedAt: iso(NOW - 3600000), lastWorkerAt: iso(NOW - 10 * 60000) })]);
  runStatus.old = new Error('gone');
  await ensureFollowup(NOW);
  assert.equal(started.length, 1, 'unknown status + silent for 10 minutes: replaced');

  // A claim that never finished does not block forever.
  reset([task({ workflowRunId: 'starting', workflowStartedAt: iso(NOW - 30000) })]);
  await ensureFollowup(NOW);
  assert.equal(started.length, 0, 'someone is starting it right now: wait');
  reset([task({ workflowRunId: 'starting', workflowStartedAt: iso(NOW - 5 * 60000) })]);
  await ensureFollowup(NOW);
  assert.equal(started.length, 1, 'stuck on "starting" for 5 minutes: start again');
  reset([task({ workflowRunId: 'starting' })]);
  await ensureFollowup(NOW);
  assert.equal(started.length, 1, '"starting" with no time at all: start again');

  // Two calls at once start one follow-up only.
  reset([task()]);
  await Promise.all([ensureFollowup(NOW), ensureFollowup(NOW)]);
  assert.equal(started.length, 1, 'two callers at once: one follow-up');

  // A failed start clears the claim so the next call can try again, and the error is raised.
  reset([task()]);
  startFails = true;
  await assert.rejects(() => ensureFollowup(NOW), /cannot start/);
  assert.equal(db.tasks[0].workflowRunId, undefined, 'a failed start leaves no stuck claim');
  startFails = false;
  await ensureFollowup(NOW + 1000);
  assert.equal(started.length, 1, 'and the next call starts it');

  // The newest running task is the one followed.
  reset([task({ id: 'old', status: 'done' }), task({ id: 't2' })]);
  await ensureFollowup(NOW);
  assert.deepEqual(started, ['t2']);

  console.log('followup regression: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
