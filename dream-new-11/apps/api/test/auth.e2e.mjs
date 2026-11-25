// End-to-end auth checks against a running API in demo mode: npm run test:e2e -w @dream11/api
const API = process.env.API_URL ?? 'http://localhost:4000';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const rnd = Math.floor(Math.random() * 1e8).toString().padStart(8, '0');

let r = await call('GET', '/health'); check('health', r.status === 200 && r.body.status === 'ok');
r = await call('GET', '/config'); check('config demo + paid off', r.body.appMode === 'demo' && r.body.paidContestsEnabled === false);

// Existing user OTP login
r = await call('POST', '/auth/otp/request', { phone: '9999999999' }); check('otp request', r.status === 200 && r.body.demoCode === '123456', JSON.stringify(r.body));
r = await call('POST', '/auth/otp/request', { phone: '9999999999' }); check('otp resend cooldown 429', r.status === 429);
r = await call('POST', '/auth/otp/verify', { phone: '9999999999', code: '000000' }); check('wrong otp 400', r.status === 400 && /attempt/.test(r.body.message), JSON.stringify(r.body));
r = await call('POST', '/auth/otp/verify', { phone: '9999999999', code: '123456' }); check('otp login existing', r.status === 200 && r.body.isNewUser === false && r.body.tokens?.accessToken, JSON.stringify(r.body));
r = await call('POST', '/auth/otp/verify', { phone: '9999999999', code: '123456' }); check('otp single-use', r.status === 400);

// New phone signup
const phone = '98' + rnd;
await call('POST', '/auth/otp/request', { phone });
r = await call('POST', '/auth/otp/verify', { phone, code: '123456' }); check('new phone -> signupToken', r.body.isNewUser === true && r.body.signupToken, JSON.stringify(r.body));
const signupToken = r.body.signupToken;
const minor = new Date(); minor.setFullYear(minor.getFullYear() - 17);
r = await call('POST', '/auth/register/phone', { signupToken, name: 'Young One', dob: minor.toISOString().slice(0, 10), acceptTerms: true });
check('under-18 rejected', r.status === 400 && r.body.fields?.dob, JSON.stringify(r.body));
r = await call('POST', '/auth/register/phone', { signupToken, name: 'Phone User', dob: '2000-05-05', acceptTerms: true });
check('phone register', r.status === 201 && r.body.user.phone === '+91' + phone, JSON.stringify(r.body));

// Email signup + login
const email = `user${rnd}@test.dev`;
r = await call('POST', '/auth/register/email', { email, password: 'Secret123', name: 'Email User', dob: '1995-01-01', acceptTerms: true });
check('email register', r.status === 201 && r.body.user.email === email, JSON.stringify(r.body));
r = await call('POST', '/auth/register/email', { email, password: 'Secret123', name: 'Email User', dob: '1995-01-01', acceptTerms: true });
check('duplicate email 409', r.status === 409);
r = await call('POST', '/auth/login/email', { email, password: 'wrong1234' }); check('bad password 401', r.status === 401);
r = await call('POST', '/auth/login/email', { email: email.toUpperCase(), password: 'Secret123' }); check('email login (case-insensitive)', r.status === 200, JSON.stringify(r.body));
let { accessToken, refreshToken } = r.body.tokens;

// Profile
r = await call('GET', '/me'); check('me without token 401', r.status === 401);
r = await call('GET', '/me', null, accessToken); check('me', r.status === 200 && r.body.email === email);
r = await call('PATCH', '/me', { name: 'Renamed User', city: 'Pune' }, accessToken); check('update profile', r.body.name === 'Renamed User' && r.body.city === 'Pune');
r = await call('PATCH', '/me/settings', { pushPromotions: true, language: 'hi' }, accessToken); check('update settings', r.body.settings?.pushPromotions === true && r.body.settings.language === 'hi');

// Avatar upload (1x1 PNG)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const fd = new FormData(); fd.append('avatar', new Blob([png], { type: 'image/png' }), 'a.png');
let res = await fetch(API + '/me/avatar', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: fd });
let av = await res.json(); check('avatar upload', res.status === 201 && av.avatarUrl?.startsWith('/uploads/avatars/'), JSON.stringify(av));
res = await fetch(API + av.avatarUrl); check('avatar served', res.status === 200);
const fd2 = new FormData(); fd2.append('avatar', new Blob([Buffer.from('not an image at all')], { type: 'image/png' }), 'x.png');
res = await fetch(API + '/me/avatar', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: fd2 }); check('fake image rejected', res.status === 400);

// Refresh rotation + reuse detection
r = await call('POST', '/auth/refresh', { refreshToken }); check('refresh', r.status === 200);
const rotated = r.body.tokens.refreshToken;
r = await call('POST', '/auth/refresh', { refreshToken }); check('old refresh reuse 401', r.status === 401);
r = await call('POST', '/auth/refresh', { refreshToken: rotated }); check('family revoked after reuse', r.status === 401);

// Forgot / reset
r = await call('POST', '/auth/password/forgot', { email }); check('forgot', r.status === 200);
r = await call('POST', '/auth/password/forgot', { email: 'nobody@test.dev' }); check('forgot unknown same answer', r.status === 200);
r = await call('POST', '/auth/password/reset', { email, code: '123456', password: 'NewPass999' }); check('reset', r.status === 200, JSON.stringify(r.body));
r = await call('POST', '/auth/login/email', { email, password: 'NewPass999' }); check('login with new password', r.status === 200);
refreshToken = r.body.tokens.refreshToken;

// Logout
r = await call('POST', '/auth/logout', { refreshToken }); check('logout 204', r.status === 204);
r = await call('POST', '/auth/refresh', { refreshToken }); check('refresh after logout 401', r.status === 401);

// Validation shape
r = await call('POST', '/auth/register/email', { email: 'bad', password: 'x', name: '', dob: 'x', acceptTerms: false });
check('validation fields', r.status === 400 && r.body.fields?.email && r.body.fields?.password, JSON.stringify(r.body));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
