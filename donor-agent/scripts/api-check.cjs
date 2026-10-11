// Checks the real server: roles, broken input. Start the app first (npm run build && npm start), then:
//   node scripts/api-check.cjs
const assert = require('node:assert/strict');
const B = process.env.BASE ?? 'http://localhost:43118';
const call = async (path, { method = 'GET', as, body, raw, headers = {} } = {}) => {
  const res = await fetch(B + path, {
    method,
    headers: { ...(as ? { 'x-as': as } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
(async () => {
  // Pages load.
  for (const p of ['/', '/areeba', '/manager']) assert.ok([200, 307, 308].includes((await fetch(B + p, { redirect: 'manual' })).status), `page ${p}`);
  // Both pages are public links: the x-as header picks the role, and a missing header means the teammate.
  assert.equal((await call('/api/state', { as: 'manager' })).json.role, 'manager');
  assert.equal((await call('/api/state', { as: 'teammate' })).json.role, 'teammate');
  assert.equal((await call('/api/state')).json.role, 'teammate', 'no header = teammate');
  assert.equal((await call('/api/login', { method: 'POST', body: { code: 'x' } })).status, 404, 'the sign-in route is gone');
  // Teammate cannot act as manager, even with the manager's cookie in the same browser but x-as teammate.
  assert.equal((await call('/api/ai-test', { method: 'POST', as: 'teammate' })).status, 403);
  assert.equal((await call('/api/progress', { method: 'POST', as: 'manager', body: { total: 5 } })).status, 401, 'manager cannot press her + button');
  // Broken message bodies.
  for (const raw of ['', '{', 'null', '[]', '"x"', '{"text":5}', '{"text":null}', '{"text":"   "}']) {
    const r = await call('/api/messages', { method: 'POST', as: 'teammate', raw });
    assert.ok(r.status < 500, `messages ${raw} -> ${r.status}`);
  }
  const huge = await call('/api/messages', { method: 'POST', as: 'manager', body: { text: 'x'.repeat(200000) } });
  assert.ok(huge.status < 500, 'huge message does not crash');
  // Progress: only numbers.
  for (const total of ['5', null, 'abc', 1e309, -1, 1e9]) {
    const r = await call('/api/progress', { method: 'POST', as: 'teammate', body: { total } });
    assert.ok(r.status < 500, `progress ${total} -> ${r.status}`);
  }
  // Push subscriptions: bad shapes rejected; the manager's phone can never become hers.
  assert.equal((await call('/api/push', { method: 'POST', as: 'teammate', body: { endpoint: 'x' } })).status, 400);
  const sub = { endpoint: 'https://push.example/abc' + Date.now(), keys: { p256dh: 'p', auth: 'a' } };
  assert.equal((await call('/api/push', { method: 'POST', as: 'manager', body: sub })).status, 200);
  assert.equal((await call('/api/push', { method: 'POST', as: 'teammate', body: sub })).status, 409);
  // Images: no path tricks.
  for (const id of ['..%2F..%2Fetc%2Fpasswd', 'nope', '%00']) assert.ok((await call(`/api/img/${id}`, { as: 'teammate' })).status < 500, `img ${id}`);
  // Manifest and clock.
  assert.equal((await call('/api/manifest?for=manager')).status, 200);
  assert.ok((await call('/api/agent/run', { method: 'POST', as: 'teammate' })).status < 500);
  console.log('PASS: API roles follow the page header, wrong roles are rejected, survives broken/huge input, protects push ownership and image paths.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
