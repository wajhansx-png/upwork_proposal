// The Redis path of the storage: fake Upstash REST server, real db.ts.
// Checks: data saved and read back, the lock is taken and released (EVAL), cached reads cost no Redis command,
// a write refreshes the cached copy, and two parallel writers both land.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);

const store = new Map();
const log = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer test') return res.writeHead(401).end(JSON.stringify({ error: 'wrong token' }));
    const cmd = JSON.parse(body);
    log.push(cmd[0]);
    let result = null;
    if (cmd[0] === 'GET') result = store.get(cmd[1]) ?? null;
    else if (cmd[0] === 'SET') {
      if (cmd.includes('NX') && store.has(cmd[1])) result = null;
      else { store.set(cmd[1], cmd[2]); result = 'OK'; }
    } else if (cmd[0] === 'DEL') result = store.delete(cmd[1]) ? 1 : 0;
    else if (cmd[0] === 'EVAL') {
      // The unlock script: delete KEYS[1] only if it equals ARGV[1].
      assert.match(cmd[1], /GET.*KEYS\[1\].*ARGV\[1\].*DEL/s);
      assert.equal(cmd[2], 1);
      const [key, id] = [cmd[3], cmd[4]];
      result = store.get(key) === id ? (store.delete(key), 1) : 0;
    } else return res.writeHead(400).end(JSON.stringify({ error: 'unknown ' + cmd[0] }));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // Prefixed names, as Vercel's Upstash connect can create them. A read-only token must not be picked.
  process.env.dsad_KV_REST_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.dsad_KV_REST_API_READ_ONLY_TOKEN = 'read-only';
  process.env.dsad_KV_REST_API_TOKEN = 'test';
  delete process.env.BLOB_STORE_ID;
  const { withDb, readDb } = require('../src/lib/db.ts');

  // Write, then the lock is gone and the data is stored.
  await withDb((d) => { d.messages.push({ id: 'a', text: 'one' }); });
  assert.ok(!store.has('donor-desk:lock'), 'lock must be released');
  assert.ok(String(store.get('donor-desk:db')).includes('"id":"a"'));
  assert.ok(log.includes('EVAL'), 'unlock uses one EVAL');

  // Reads inside the cache window cost no Redis command and return a private copy.
  let before = log.length;
  const r1 = await readDb();
  const r2 = await readDb();
  assert.equal(log.length, before, 'cached reads must not call Redis');
  r1.messages.length = 0;
  assert.equal(r2.messages.length, 1, 'a read must be a private copy');
  assert.equal((await readDb()).messages.length, 1);

  // A write is visible to the next read at once.
  await withDb((d) => { d.messages.push({ id: 'b', text: 'two' }); });
  assert.deepEqual((await readDb()).messages.map((m) => m.id), ['a', 'b']);

  // Parallel writers both land, and the lock ends free.
  await Promise.all([1, 2, 3, 4, 5].map((n) => withDb((d) => { d.messages.push({ id: 'p' + n, text: String(n) }); })));
  assert.equal((await readDb()).messages.length, 7);
  assert.ok(!store.has('donor-desk:lock'));

  // A lock someone else holds is not deleted by us.
  store.set('donor-desk:lock', 'someone-else');
  const done = withDb((d) => { d.messages.push({ id: 'late', text: 'x' }); });
  setTimeout(() => store.delete('donor-desk:lock'), 250);
  await done;
  assert.equal((await readDb()).messages.at(-1).id, 'late');
  console.log('PASS: redis storage (save/read, one-command unlock, cached reads are free and private, writes refresh, parallel writers, foreign lock respected).');
  server.close();
})().catch((e) => { console.error(e); process.exitCode = 1; server.close(); });
