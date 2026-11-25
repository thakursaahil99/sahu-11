// Hardening checks against the running API: headers, CORS, limits, input handling, tokens.
const API = process.env.API_URL ?? 'http://localhost:4000';
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`);
};
async function call(method, path, body, token, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

// ── Headers ──
let r = await call('GET', '/health');
check('health reports the database is up', r.status === 200 && r.body.status === 'ok');
check('security headers (Helmet)', r.headers.get('x-content-type-options') === 'nosniff' && !!r.headers.get('strict-transport-security') && !!r.headers.get('content-security-policy'));
check('no x-powered-by', !r.headers.get('x-powered-by'));

// ── CORS ──
r = await call('OPTIONS', '/auth/login/email', null, null, { origin: 'https://evil.example', 'access-control-request-method': 'POST' });
check('unknown browser origins get no CORS grant', !r.headers.get('access-control-allow-origin'));
r = await call('OPTIONS', '/auth/login/email', null, null, { origin: 'http://localhost:5174', 'access-control-request-method': 'POST' });
check('the admin panel origin is allowed', r.headers.get('access-control-allow-origin') === 'http://localhost:5174');

// ── Input handling ──
r = await call('POST', '/auth/login/email', '{"email": "a@b.c", "password": ');
check('malformed JSON → 400, not 500', r.status === 400, String(r.status));
r = await call('POST', '/auth/login/email', { email: 'a@b.c', password: 'x'.repeat(200_000) });
check('bodies over 100 kB are refused (413)', r.status === 413, String(r.status));
r = await call('GET', '/this-route-does-not-exist');
check('unknown routes → JSON 404', r.status === 404 && r.body?.statusCode === 404);
r = await call('POST', '/auth/login/email', { email: "admin@dreamnew11.app' --", password: 'x' });
check('SQL-shaped login input is just a validation error', r.status === 400 || r.status === 401);

const admin = (await call('POST', '/admin/auth/login', { email: 'admin@dreamnew11.app', password: 'Admin@1234' })).body.tokens.accessToken;
r = await call('GET', `/admin/users?q=${encodeURIComponent("' OR 1=1; DROP TABLE \"User\";--")}`, null, admin);
check('search text is a parameter, never SQL', r.status === 200 && r.body.items.length === 0);
r = await call('GET', '/health');
check('…and the database is still fine', r.status === 200);
r = await call('GET', '/admin/users?limit=100000', null, admin);
check('page size is capped', r.status === 400);

// ── Tokens ──
const login = await call('POST', '/auth/login/email', { email: 'demo@dreamnew11.app', password: 'Demo@1234' });
const token = login.body.tokens.accessToken;
const [h, p] = token.split('.');
const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, role: 'SUPER_ADMIN', scope: 'admin', mfa: true })).toString('base64url')}.${token.split('.')[2]}`;
r = await call('GET', '/admin/overview', null, forged);
check('a tampered token (role/scope edited) is rejected', r.status === 401);
const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...payload, role: 'SUPER_ADMIN' })).toString('base64url')}.`;
r = await call('GET', '/me', null, none);
check('alg:none tokens are rejected', r.status === 401);

r = await call('GET', "/matches?sport=cricket&status=UPCOMING' OR 1=1--", null, token);
check('query params are validated (injection-shaped value → 400)', r.status === 400, String(r.status));

// ── Mass assignment / profile ──
r = await call('PATCH', '/me', { city: 'Pune', role: 'SUPER_ADMIN', status: 'ACTIVE', referralCode: 'HACKED' }, token);
check('unknown fields are ignored (no role escalation)', r.status === 200 && r.body.role === 'USER' && r.body.referralCode !== 'HACKED', JSON.stringify(r.body).slice(0, 200));
r = await call('PATCH', '/me', { state: 'XX' }, token);
check('state must be a real state code', r.status === 400 && r.body.fields?.state);
r = await call('PATCH', '/me', { state: 'MH' }, token);
check('state of residence saved', r.status === 200 && r.body.state === 'MH');
await call('PATCH', '/me', { city: 'Mumbai' }, token);

// ── Error bodies never leak internals ──
r = await call('GET', '/contests/not-a-real-id', null, token);
check('errors have the standard shape and no stack traces', typeof r.body?.message === 'string' && !JSON.stringify(r.body).includes(' at '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
