// Notifications, history, support, responsible play and account deletion over HTTP.
const API = process.env.API_URL ?? 'http://localhost:4000';
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`);
};
async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
async function newUser(name) {
  const phone = '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  await call('POST', '/auth/otp/request', { phone });
  const v = await call('POST', '/auth/otp/verify', { phone, code: '123456' });
  const r = await call('POST', '/auth/register/phone', { signupToken: v.body.signupToken, name, dob: '1993-03-03', acceptTerms: true });
  return { token: r.body.tokens.accessToken, refresh: r.body.tokens.refreshToken, phone };
}

const A = await newUser('Account Tester');
const B = await newUser('Other Tester');

// ── Notifications ──
let r = await call('GET', '/notifications', null, A.token);
check('notification centre starts empty', r.status === 200 && r.body.items.length === 0 && r.body.unread === 0 && r.body.nextCursor === null, JSON.stringify(r.body));
r = await call('POST', '/notifications/read', { all: true }, A.token);
check('mark all read works on an empty list', r.status === 200 && r.body.unread === 0);
r = await call('POST', '/notifications/read', { ids: [] }, A.token);
check('mark read validates input', r.status === 400);
r = await call('POST', '/me/push-tokens', { token: 'ExponentPushToken[e2e-test-device-0001]', kind: 'EXPO', platform: 'ANDROID' }, A.token);
check('register push token', r.status === 204);
r = await call('POST', '/me/push-tokens', { token: 'ExponentPushToken[e2e-test-device-0001]', kind: 'EXPO', platform: 'ANDROID' }, B.token);
check('same device re-registered by another account moves to it', r.status === 204);
r = await call('POST', '/me/push-tokens', { token: 'short', kind: 'APNS', platform: 'ANDROID' }, A.token);
check('invalid push token rejected', r.status === 400);
r = await call('DELETE', '/me/push-tokens', { token: 'ExponentPushToken[e2e-test-device-0001]' }, B.token);
check('unregister push token', r.status === 204);

// ── History ──
r = await call('GET', '/me/stats', null, A.token);
check('stats for a new user are zero', r.status === 200 && r.body.contests === 0 && r.body.teams === 0 && r.body.wins === 0 && r.body.recent.length === 0, JSON.stringify(r.body));
r = await call('GET', '/me/contests', null, A.token);
check('contest history empty', r.status === 200 && r.body.items.length === 0 && r.body.nextCursor === null);
r = await call('GET', '/me/contests?limit=500', null, A.token);
check('history limit is bounded', r.status === 400);

// ── Support ──
r = await call('POST', '/support/tickets', { category: 'PAYMENTS', subject: 'Hi', message: 'short' }, A.token);
check('ticket validation (subject + message length)', r.status === 400 && r.body.fields?.subject && r.body.fields?.message, JSON.stringify(r.body));
r = await call('POST', '/support/tickets', { category: 'CONTESTS', subject: 'Points look wrong', message: 'My captain scored a fifty but my team points did not double.' }, A.token);
const ticket = r.body;
check('ticket created with a reference', r.status === 201 && /^DN-\d{5,6}$/.test(ticket.reference) && ticket.status === 'OPEN' && ticket.messages.length === 1, JSON.stringify(r.body));
r = await call('POST', `/support/tickets/${ticket.id}/messages`, { message: 'Screenshot attached later.' }, A.token);
check('user can add a message', r.status === 201 && r.body.messages.length === 2 && r.body.lastMessage === 'Screenshot attached later.');
r = await call('GET', '/support/tickets', null, A.token);
check('ticket list shows it', r.body.length === 1 && r.body[0].id === ticket.id);
r = await call('GET', `/support/tickets/${ticket.id}`, null, B.token);
check('other users cannot read it (404)', r.status === 404);
r = await call('POST', `/support/tickets/${ticket.id}/messages`, { message: 'sneaky' }, B.token);
check('other users cannot reply (404)', r.status === 404);

// ── Responsible play ──
r = await call('GET', '/me/responsible-play', null, A.token);
check('responsible play defaults', r.status === 200 && r.body.status === 'ACTIVE' && r.body.limits.daily === null && r.body.usage.daily === 0, JSON.stringify(r.body));
r = await call('PUT', '/me/responsible-play/limits', { daily: 2000, weekly: 1000, monthly: null }, A.token);
check('daily above weekly rejected', r.status === 400 && r.body.fields?.weekly, JSON.stringify(r.body));
r = await call('PUT', '/me/responsible-play/limits', { daily: 1000, weekly: 5000, monthly: 10000 }, A.token);
check('new limits apply immediately', r.status === 200 && r.body.limits.daily === 1000 && r.body.limits.monthly === 10000 && r.body.pending === null, JSON.stringify(r.body));
r = await call('PUT', '/me/responsible-play/limits', { daily: 3000, weekly: 5000, monthly: 10000 }, A.token);
check('raising waits for cooling-off (pending lists only what changes)', r.body.limits.daily === 1000 && r.body.pending?.daily === 3000 && Object.keys(r.body.pending).length === 1 && !!r.body.pendingEffectiveAt, JSON.stringify(r.body));
r = await call('DELETE', '/me/responsible-play/limits/pending', null, A.token);
check('pending raise can be cancelled', r.status === 200 && r.body.pending === null && r.body.limits.daily === 1000);
r = await call('POST', '/me/responsible-play/break', { days: 3 }, A.token);
check('break length must be an offered option', r.status === 400);
r = await call('POST', '/me/responsible-play/break', { days: 7 }, A.token);
check('take a 7-day break', r.status === 200 && r.body.status === 'ON_BREAK' && Date.parse(r.body.excludedUntil) > Date.now() + 6 * 86_400_000, JSON.stringify(r.body));

const feed = await call('GET', '/matches/feed?sport=cricket', null, A.token);
const match = feed.body.upcoming.find((m) => Date.parse(m.startTime) > Date.now() + 10 * 60_000);
const contests = await call('GET', `/matches/${match.id}/contests`, null, A.token);
r = await call('POST', `/contests/${contests.body.contests[0].id}/join`, { teamIds: ['cl0000000000000000000000'] }, A.token);
check('joining a contest is blocked during the break', r.status === 403 && /break/.test(r.body.message), JSON.stringify(r.body));
const ids = Array.from({ length: 11 }, (_, i) => `cl${String(i).padStart(22, '0')}`);
r = await call('POST', '/teams', { matchId: match.id, playerIds: ids, captainId: ids[0], viceCaptainId: ids[1] }, A.token);
check('creating teams is blocked during the break', r.status === 403 && /break/.test(r.body.message), JSON.stringify(r.body));
r = await call('GET', '/wallet', null, A.token);
check('wallet stays viewable during the break', r.status === 200);
r = await call('POST', '/me/responsible-play/break', { days: 1 }, A.token);
check('break cannot be shortened', r.status === 400);

// ── Account deletion ──
r = await call('DELETE', '/me', { confirm: 'delete' }, B.token);
check('deletion needs the exact confirmation word', r.status === 400);
r = await call('DELETE', '/me', { confirm: 'DELETE' }, B.token);
check('account deleted', r.status === 204, JSON.stringify(r.body));
r = await call('GET', '/me', null, B.token);
check('old access token stops working immediately', r.status === 401, JSON.stringify(r.body));
r = await call('POST', '/auth/refresh', { refreshToken: B.refresh }, null);
check('refresh token revoked', r.status === 401);
await call('POST', '/auth/otp/request', { phone: B.phone });
const again = await call('POST', '/auth/otp/verify', { phone: B.phone, code: '123456' });
check('the phone number is free again (signs up as new)', again.body?.isNewUser === true, JSON.stringify(again.body));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
