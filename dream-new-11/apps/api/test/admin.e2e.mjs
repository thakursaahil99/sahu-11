// Admin API: sessions, 2FA, RBAC, step-up re-auth and the main admin actions, over HTTP.
import { createHmac } from 'node:crypto';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Independent RFC 6238 implementation, to check the server's.
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret, offset = 0) {
  const step = Math.floor(Date.now() / 30000) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const login = async (email, password = 'Admin@1234') => (await call('POST', '/admin/auth/login', { email, password })).body;
const reauth = async (token) => (await call('POST', '/admin/auth/reauth', { password: 'Admin@1234' }, token)).body.reauthToken;
const R = (t) => ({ 'x-reauth-token': t });

// ── Sessions ──
let r = await call('POST', '/admin/auth/login', { email: 'admin@dreamnew11.app', password: 'wrong-pass' });
check('wrong password → 401', r.status === 401);
r = await call('POST', '/admin/auth/login', { email: 'demo@dreamnew11.app', password: 'Demo@1234' });
check('players can’t sign in to the panel (same message as a wrong password)', r.status === 401 && /Invalid email or password/.test(r.body.message));
const superS = await login('admin@dreamnew11.app');
const SA = superS.tokens.accessToken;
check('super admin signs in', superS.mfaRequired === false && superS.me.role === 'SUPER_ADMIN' && superS.me.permissions.includes('users.roles'));

const app = await call('POST', '/auth/login/email', { email: 'admin@dreamnew11.app', password: 'Admin@1234' });
r = await call('GET', '/admin/overview', null, app.body.tokens.accessToken);
check('an app-session token can’t use admin routes', r.status === 403 && r.body.code === 'ADMIN_SESSION_REQUIRED', JSON.stringify(r.body));
r = await call('GET', '/admin/overview', null, null);
check('admin routes need a session', r.status === 401);

r = await call('GET', '/admin/overview', null, SA);
check('dashboard overview', r.status === 200 && typeof r.body.users === 'number' && Array.isArray(r.body.signups) && 'pendingWithdrawals' in r.body, JSON.stringify(r.body));
r = await call('POST', '/auth/refresh', { refreshToken: superS.tokens.refreshToken });
const refreshed = r.body.tokens?.accessToken;
r = await call('GET', '/admin/overview', null, refreshed);
check('refreshing keeps the admin scope', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);

// ── RBAC ──
const contentS = await login('content@dreamnew11.app');
const content = contentS.tokens.accessToken;
const support = (await login('support@dreamnew11.app')).tokens.accessToken;
const finance = (await login('finance@dreamnew11.app')).tokens.accessToken;
r = await call('GET', '/admin/users', null, content);
check('content admin can’t see users', r.status === 403 && r.body.code === 'FORBIDDEN_ROLE');
r = await call('GET', '/admin/withdrawals', null, support);
check('support can’t see withdrawals', r.status === 403);
r = await call('GET', '/admin/config/scoring', null, finance);
check('finance can’t edit scoring', r.status === 403);
r = await call('GET', '/admin/audit', null, finance);
check('finance can read the audit log', r.status === 200);
r = await call('GET', '/admin/tickets', null, support);
check('support sees the ticket inbox', r.status === 200 && Array.isArray(r.body.items));

// ── A player to act on ──
const email = `adm${Date.now()}@test.dev`;
r = await call('POST', '/auth/register/email', { email, password: 'Secret123', name: 'Admin Target', dob: '1994-04-04', acceptTerms: true });
const P = r.body.tokens.accessToken;
const pid = r.body.user.id;

r = await call('GET', `/admin/users?q=${encodeURIComponent(email)}`, null, support);
check('search users by email', r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === pid, JSON.stringify(r.body));
r = await call('GET', `/admin/users/${pid}`, null, SA);
check('user detail with balances, never secrets', r.status === 200 && r.body.balances.DEMO && !('passwordHash' in r.body.user) && !('mfaSecret' in r.body.user));

r = await call('POST', `/admin/users/${pid}/restrict`, { reason: 'Multiple accounts on one device' }, support);
check('support restricts a player', r.status === 200);
const feed = await call('GET', '/matches/feed?sport=cricket', null, P);
const match = feed.body.upcoming.find((m) => Date.parse(m.startTime) > Date.now() + 10 * 60_000);
const contests = await call('GET', `/matches/${match.id}/contests`, null, P);
r = await call('POST', `/contests/${contests.body.contests[0].id}/join`, { teamIds: ['cl0000000000000000000000'] }, P);
check('a restricted player can’t join contests', r.status === 403 && /restricted/.test(r.body.message), JSON.stringify(r.body));
r = await call('GET', '/me/responsible-play', null, P);
check('…and sees the reason in the app', r.body.status === 'RESTRICTED' && r.body.restrictionReason === 'Multiple accounts on one device');
r = await call('POST', `/admin/users/${pid}/unrestrict`, null, support);
check('unrestrict', r.status === 200 && (await call('GET', '/me/responsible-play', null, P)).body.status === 'ACTIVE');

// ── Step-up ──
r = await call('POST', `/admin/users/${pid}/suspend`, { reason: 'Fraud investigation' }, support);
check('sensitive action without step-up → REAUTH_REQUIRED', r.status === 403 && r.body.code === 'REAUTH_REQUIRED');
r = await call('POST', '/admin/auth/reauth', { password: 'nope' }, support);
check('step-up with the wrong password fails', r.status === 401);
const supportRe = await reauth(support);
r = await call('POST', `/admin/users/${pid}/suspend`, { reason: 'Fraud investigation' }, support, R(supportRe));
check('suspend with step-up', r.status === 200);
r = await call('GET', '/me', null, P);
check('suspended player is signed out at once', r.status === 401);
r = await call('POST', `/admin/users/${pid}/suspend`, { reason: 'Fraud investigation' }, content, R(supportRe));
check('a step-up token only works for the person who made it', r.status === 403);

// ── Support reply → user notification ──
const P2s = await call('POST', '/auth/register/email', { email: `t${email}`, password: 'Secret123', name: 'Ticket Person', dob: '1994-04-04', acceptTerms: true });
const P2 = P2s.body.tokens.accessToken;
const t = await call('POST', '/support/tickets', { category: 'ACCOUNT', subject: 'Cannot change my name', message: 'The edit profile screen does not save my new name.' }, P2);
r = await call('POST', `/admin/tickets/${t.body.id}/reply`, { message: 'Fixed now — please try again.', status: 'AWAITING_USER' }, support);
check('staff reply', r.status === 200 && r.body.messages.at(-1).fromStaff === true && r.body.messages.at(-1).staffName === 'Support Agent');
await sleep(400);
r = await call('GET', `/support/tickets/${t.body.id}`, null, P2);
check('user sees the reply and status', r.body.status === 'AWAITING_USER' && r.body.messages.length === 2);
r = await call('GET', '/notifications', null, P2);
check('user is notified about the reply', r.body.items.some((n) => n.type === 'SUPPORT' && n.url === `/support/${t.body.id}`));

// ── KYC review → notification ──
const pan = `ADMKY${String(Date.now()).slice(-4)}Q`;
await call('POST', '/me/kyc', { fullName: 'Ticket Person', pan }, P2);
r = await call('GET', '/admin/kyc', null, finance);
const u2 = (await call('GET', '/me', null, P2)).body.id;
check('pending KYC queue', r.status === 200 && r.body.some((k) => k.userId === u2 && k.panMasked.endsWith(pan.slice(-3))));
r = await call('POST', `/admin/kyc/${u2}/review`, { approve: false }, finance);
check('rejecting needs a note', r.status === 400);
r = await call('POST', `/admin/kyc/${u2}/review`, { approve: true }, finance);
check('finance verifies KYC', r.status === 200 && (await call('GET', '/me/kyc', null, P2)).body.status === 'VERIFIED');
await sleep(300);
check('user is notified', (await call('GET', '/notifications', null, P2)).body.items.some((n) => n.type === 'KYC'));

// ── Content: scoring, fantasy, players, contests ──
r = await call('GET', '/admin/config/scoring', null, content);
const t20 = r.body.find((s) => s.format === 'T20' && s.sport.key === 'cricket');
check('scoring tables listed (T20/T10/ODI)', r.status === 200 && !!t20 && t20.rules.wicket > 0);
const contentRe = await reauth(content);
r = await call('PUT', `/admin/config/scoring/${t20.id}`, { ...t20.rules, wicket: 'lots' }, content, R(contentRe));
check('invalid scoring table rejected', r.status === 400);
r = await call('PUT', `/admin/config/scoring/${t20.id}`, { ...t20.rules, wicket: t20.rules.wicket }, content, R(contentRe));
check('scoring table saved', r.status === 200);
r = await call('GET', '/admin/config/fantasy', null, content);
const cricket = r.body.find((f) => f.sport.key === 'cricket');
r = await call('PUT', `/admin/config/fantasy/${cricket.sport.id}`, { ...cricket.rules, roleLimits: { ...cricket.rules.roleLimits, WK: { min: 5, max: 2 } } }, content, R(contentRe));
check('impossible team rules rejected', r.status === 400, JSON.stringify(r.body));
r = await call('PUT', `/admin/config/fantasy/${cricket.sport.id}`, cricket.rules, content, R(contentRe));
check('team rules saved', r.status === 200 && r.body.maxCredits === cricket.rules.maxCredits);
r = await call('GET', '/admin/players?q=a&limit=1', null, content);
const player = r.body.items[0];
r = await call('PUT', `/admin/players/${player.id}`, { credits: 8.3 }, content);
check('credits must be in 0.5 steps', r.status === 400);
r = await call('PUT', `/admin/players/${player.id}`, { credits: player.credits }, content);
check('player credits updated', r.status === 200 && r.body.credits === player.credits);

const base = { matchId: match.id, name: 'Admin Test Free', type: 'FREE', entryFee: 0, prizePool: 300, totalSpots: 10, maxEntriesPerUser: 1, guaranteed: true };
r = await call('POST', '/admin/contests', { ...base, prizeBreakup: [{ fromRank: 1, toRank: 1, amount: 500 }] }, content);
check('breakup above the pool rejected', r.status === 400 && r.body.fields?.prizeBreakup, JSON.stringify(r.body));
r = await call('POST', '/admin/contests', { ...base, type: 'PUBLIC', entryFee: 49, prizeBreakup: [{ fromRank: 1, toRank: 1, amount: 300 }] }, content);
check('paid contests refused in demo mode', r.status === 403);
r = await call('POST', '/admin/contests', { ...base, prizeBreakup: [{ fromRank: 1, toRank: 1, amount: 200 }, { fromRank: 2, toRank: 2, amount: 100 }] }, content);
const created = r.body;
check('free contest created', r.status === 201 && created.currency === 'DEMO' && created.prizePoolX100 === 30000, JSON.stringify(r.body));
r = await call('GET', `/matches/${match.id}/contests`, null, P2);
check('players see the new contest', r.body.contests.some((c) => c.id === created.id));
r = await call('POST', `/admin/contests/${created.id}/cancel`, { reason: 'Created by mistake' }, content);
check('cancelling needs step-up', r.status === 403 && r.body.code === 'REAUTH_REQUIRED');
r = await call('POST', `/admin/contests/${created.id}/cancel`, { reason: 'Created by mistake' }, content, R(contentRe));
check('contest cancelled', r.status === 200);
r = await call('POST', `/admin/contests/${created.id}/cancel`, { reason: 'Created by mistake' }, content, R(contentRe));
check('…only once', r.status === 400);

// ── Announcements ──
r = await call('POST', '/admin/announcements', { title: 'Big weekend', body: 'Free mega contests all weekend!', url: '/home', audience: 'ALL', promotional: false }, content, R(contentRe));
check('announcement sent to players', r.status === 201 && r.body.recipients > 0, JSON.stringify(r.body));
await sleep(500);
check('…and it lands in their notification centre', (await call('GET', '/notifications', null, P2)).body.items.some((n) => n.type === 'ANNOUNCEMENT' && n.title === 'Big weekend'));
r = await call('POST', '/admin/announcements', { title: 'x', body: 'y', audience: 'ALL', promotional: false }, content, R(contentRe));
check('announcement validation', r.status === 400);

// ── Risk + audit ──
r = await call('POST', '/admin/risk/scan', null, support);
check('risk scan runs', r.status === 200 && 'MULTI_ACCOUNT_IP' in r.body);
r = await call('GET', '/admin/risk?status=OPEN', null, support);
check('risk flags listed', r.status === 200 && Array.isArray(r.body.items));
if (r.body.items[0]) {
  const f = r.body.items[0];
  r = await call('POST', `/admin/risk/${f.id}/resolve`, { status: 'DISMISSED', note: 'Shared office network (test)' }, support);
  check('flag dismissed with a note', r.status === 200);
}
r = await call('GET', `/admin/audit?userId=${pid}`, null, SA);
check('audit log records admin actions', r.body.items.some((a) => a.action === 'admin.user_suspended' && a.actor?.name === 'Support Agent') && r.body.items.some((a) => a.action === 'admin.user_restricted'));

// ── 2FA (on the content admin account) ──
r = await call('POST', '/admin/auth/mfa/setup', null, content);
const secret = r.body.secret;
check('2FA setup returns a secret and otpauth URL', r.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && r.body.otpauthUrl.startsWith('otpauth://totp/'));
r = await call('POST', '/admin/auth/mfa/enable', { code: '000000' }, content);
check('wrong code doesn’t enable 2FA', r.status === 401);
r = await call('POST', '/admin/auth/mfa/enable', { code: totp(secret) }, content);
check('2FA enabled; session upgraded', r.status === 200 && r.body.me.mfaEnabled && r.body.me.mfaVerified);
r = await call('POST', '/auth/refresh', { refreshToken: contentS.tokens.refreshToken });
check('older sessions are signed out when 2FA is turned on', r.status === 401);
const step1 = await login('content@dreamnew11.app');
check('login now asks for a code', step1.mfaRequired === true && !!step1.challenge && !step1.tokens);
r = await call('POST', '/admin/auth/mfa', { challenge: step1.challenge, code: totp(secret) }, null);
check('same code can’t be used twice (replay)', r.status === 401, JSON.stringify(r.body));
await sleep(Math.max(0, 30_000 - (Date.now() % 30_000)) + 300);
r = await call('POST', '/admin/auth/mfa', { challenge: step1.challenge, code: totp(secret) }, null);
check('fresh code completes sign-in', r.status === 200 && r.body.me.mfaVerified === true, JSON.stringify(r.body));
r = await call('POST', '/admin/auth/mfa', { challenge: 'not.a.token', code: '123456' }, null);
check('forged challenge rejected', r.status === 401);

const saRe = await reauth(SA);
const contentId = r.body?.me?.id ?? step1.me?.id;
const found = (await call('GET', '/admin/users?q=content@dreamnew11.app', null, SA)).body.items;
check('searching an email with digits doesn’t match phone numbers', found.length === 1 && found[0].email === 'content@dreamnew11.app', JSON.stringify(found.map((u) => u.email)));
const contentUser = found[0];
r = await call('POST', `/admin/users/${contentUser.id}/reset-mfa`, null, SA, R(saRe));
const afterReset = await login('content@dreamnew11.app');
check('super admin resets a lost authenticator', r.status === 200 && afterReset.mfaRequired === false, `${r.status} ${JSON.stringify(r.body).slice(0, 160)} ${JSON.stringify(afterReset).slice(0, 120)} ${contentId}`);

// ── Roles ──
r = await call('POST', `/admin/users/${superS.me.id}/role`, { role: 'USER' }, SA, R(saRe));
check('can’t change your own role', r.status === 400);
r = await call('POST', `/admin/users/${u2}/role`, { role: 'SUPPORT' }, SA, R(saRe));
check('promote a player to support', r.status === 200);
const newStaff = await login(`t${email}`, 'Secret123');
check('…who can now sign in to the panel', newStaff.mfaRequired === false && newStaff.me.role === 'SUPPORT');
r = await call('POST', `/admin/users/${u2}/role`, { role: 'USER' }, SA, R(saRe));
r = await call('GET', '/admin/tickets', null, newStaff.tokens.accessToken);
check('demotion applies immediately', r.status === 403 || r.status === 401, String(r.status));
r = await call('POST', '/auth/refresh', { refreshToken: newStaff.tokens.refreshToken });
check('…and their admin sessions are revoked', r.status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
