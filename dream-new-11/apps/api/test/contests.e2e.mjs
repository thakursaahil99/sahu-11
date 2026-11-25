// End-to-end contest checks against a running API in demo mode: npm run test:e2e -w @dream11/api
import { PrismaClient } from '@prisma/client';

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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function newUser(name) {
  const phone = '8' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  await call('POST', '/auth/otp/request', { phone });
  const v = await call('POST', '/auth/otp/verify', { phone, code: '123456' });
  const r = await call('POST', '/auth/register/phone', { signupToken: v.body.signupToken, name, dob: '1994-04-04', acceptTerms: true });
  return r.body.tokens.accessToken;
}

/** Cheapest valid XI for a match: 1 WK, 4 BAT, 2 AR, 4 BOWL, at most 6 per side. */
function cheapXI(match) {
  const shape = { WK: 1, BAT: 4, AR: 2, BOWL: 4 };
  const all = match.squads.flatMap((s) => s.players);
  const xi = [];
  for (const [role, n] of Object.entries(shape)) {
    for (const p of all.filter((q) => q.role === role).sort((a, b) => a.credits - b.credits)) {
      if (xi.filter((q) => q.role === role).length >= n) break;
      if (xi.filter((q) => q.teamId === p.teamId).length >= 6) continue;
      xi.push(p);
    }
  }
  return xi;
}

/** Creates `n` distinct teams (same XI, different captains). */
async function makeTeams(token, match, n) {
  const xi = cheapXI(match);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = await call('POST', '/teams', { matchId: match.id, playerIds: xi.map((p) => p.id), captainId: xi[i].id, viceCaptainId: xi[i + 1].id }, token);
    ids.push(r.body.id);
  }
  return ids;
}

const A = await newUser('Alice Arora');
const B = await newUser('Bharat Bose');
const C = await newUser('राहुल शर्मा'); // non-Latin name: proves UTF-8 end to end

const feed = await call('GET', '/matches/feed?sport=cricket', null, A);
const [m1, m2] = feed.body.upcoming.filter((m) => Date.parse(m.startTime) > Date.now() + 15 * 60_000);
const match1 = (await call('GET', `/matches/${m1.id}`, null, A)).body;
const match2 = (await call('GET', `/matches/${m2.id}`, null, A)).body;

check('match card counts open contests', m1.contestCount === 5, String(m1.contestCount));

let r = await call('GET', `/matches/${m1.id}/contests`, null, A);
const byName = (list, name) => list.find((c) => c.name === name);
const contests = r.body.contests;
check('5 demo contests listed, none paid', r.status === 200 && contests.length === 5 && contests.every((c) => !c.isPaid) && r.body.paidContestsEnabled === false, JSON.stringify(contests.map((c) => c.name)));
const mega = byName(contests, 'Free Mega Contest');

// Limit and race tests use fresh fixture contests each run, so the suite is repeatable.
const prisma = new PrismaClient();
const fixture = (matchId, name, totalSpots, maxEntriesPerUser) =>
  prisma.contest.create({ data: { matchId, type: 'PRACTICE', name: `E2E ${name} ${Date.now()}`, totalSpots, maxEntriesPerUser, guaranteed: true } });
const h2h = await fixture(m1.id, 'H2H', 2, 1);
const top3 = await fixture(m1.id, 'Max3', 50, 3);
const h2h2 = await fixture(m2.id, 'Race', 2, 1);
const fixtures = [h2h.id, top3.id, h2h2.id];
check('mega: 10,000 DC pool, 100 winners, guaranteed', mega.prizePool === 10000 && mega.winners === 100 && mega.currency === 'DEMO' && mega.guaranteed);

const [a1, a2, a3] = await makeTeams(A, match1, 3);
const [b1] = await makeTeams(B, match1, 1);
const [c1] = await makeTeams(C, match1, 1);

// Basic join + counts
r = await call('POST', `/contests/${mega.id}/join`, { teamIds: [a1, a2] }, A);
check('join mega with 2 teams', r.status === 201 && r.body.contest.filledSpots === mega.filledSpots + 2 && r.body.contest.myEntries === 2, JSON.stringify(r.body));
await new Promise((res) => setTimeout(res, 300));
r = await call('GET', '/notifications', null, A);
check(
  'joining notifies the user (with a link to the contest)',
  r.body.items?.some((n) => n.type === 'CONTEST_JOINED' && n.url === `/contest/${mega.id}` && /T1, T2/.test(n.body)) && r.body.unread >= 1,
  JSON.stringify(r.body),
);
r = await call('POST', `/contests/${mega.id}/join`, { teamIds: [a1] }, A);
check('same team twice → 409', r.status === 409, JSON.stringify(r.body));
r = await call('POST', `/contests/${mega.id}/join`, { teamIds: [b1] }, A);
check("can't join with someone else's team", r.status === 400, JSON.stringify(r.body));

// H2H: max 1 per user, 2 spots
r = await call('POST', `/contests/${h2h.id}/join`, { teamIds: [a1] }, A);
check('H2H join', r.status === 201);
r = await call('POST', `/contests/${h2h.id}/join`, { teamIds: [a2] }, A);
check('H2H second team → 409 (max 1)', r.status === 409 && /maximum 1/.test(r.body.message), JSON.stringify(r.body));
r = await call('POST', `/contests/${h2h.id}/join`, { teamIds: [b1] }, B);
check('H2H fills', r.status === 201 && r.body.contest.spotsLeft === 0);
r = await call('POST', `/contests/${h2h.id}/join`, { teamIds: [c1] }, C);
check('full contest → 409', r.status === 409 && /full/.test(r.body.message), JSON.stringify(r.body));

// Race 1: three users at once for a fresh 2-spot H2H on match 2 → exactly 2 get in.
const [x] = await makeTeams(A, match2, 1);
const [y] = await makeTeams(B, match2, 1);
const [z] = await makeTeams(C, match2, 1);
const race = await Promise.all([
  call('POST', `/contests/${h2h2.id}/join`, { teamIds: [x] }, A),
  call('POST', `/contests/${h2h2.id}/join`, { teamIds: [y] }, B),
  call('POST', `/contests/${h2h2.id}/join`, { teamIds: [z] }, C),
]);
const h2h2After = (await call('GET', `/contests/${h2h2.id}`, null, A)).body;
check(
  'race for 2 spots: exactly 2 joins, no overfill',
  race.filter((q) => q.status === 201).length === 2 && h2h2After.filledSpots === 2 && h2h2After.leaderboard.length === 2,
  race.map((q) => q.status).join(','),
);

// Race 2: one user fires 6 joins (3 teams × 2) at a max-3 contest → exactly 3 entries.
const burst = await Promise.all([a1, a2, a3, a1, a2, a3].map((t) => call('POST', `/contests/${top3.id}/join`, { teamIds: [t] }, A)));
const top3After = (await call('GET', `/contests/${top3.id}`, null, A)).body;
check(
  'burst of 6 joins against max-3: exactly 3 entries',
  burst.filter((q) => q.status === 201).length === 3 && top3After.myEntries === 3 && top3After.filledSpots === 3,
  burst.map((q) => q.status).join(','),
);

// Switch team
let detail = (await call('GET', `/contests/${mega.id}`, null, A)).body;
const entry = detail.myTeams.find((e) => e.teamId === a1);
r = await call('PUT', `/contests/${mega.id}/entries/${entry.entryId}`, { teamId: a3 }, A);
check('switch T1 → T3', r.status === 200 && r.body.myTeams.some((e) => e.teamId === a3) && !r.body.myTeams.some((e) => e.teamId === a1), JSON.stringify(r.body.myTeams));
r = await call('PUT', `/contests/${mega.id}/entries/${entry.entryId}`, { teamId: a2 }, A);
check('switch to a team already in → 409', r.status === 409);
r = await call('PUT', `/contests/${mega.id}/entries/${entry.entryId}`, { teamId: b1 }, B);
check("can't switch someone else's entry", r.status === 404);

// Detail content
detail = (await call('GET', `/contests/${mega.id}`, null, A)).body;
check(
  'detail: breakup, rules, leaderboard, joinable',
  detail.prizeBreakup.length === 6 && detail.rules.length >= 4 && detail.leaderboard.some((l) => l.isMe && l.userName === 'Alice Arora') && detail.joinable,
);

// Private contest
r = await call('POST', '/contests/private', { matchId: m1.id, name: 'Office League', totalSpots: 3, maxEntriesPerUser: 1, teamId: a1 }, A);
check('create private (creator auto-joined)', r.status === 201 && r.body.type === 'PRIVATE' && /^[A-Z2-9]{8}$/.test(r.body.inviteCode) && r.body.filledSpots === 1, JSON.stringify(r.body));
const priv = r.body;
r = await call('GET', `/contests/${priv.id}`, null, B);
check('outsider cannot open private contest by id', r.status === 404);
r = await call('GET', `/contests/invite/${priv.inviteCode.toLowerCase()}`, null, B);
check('invite lookup (case-insensitive)', r.status === 200 && r.body.contest.id === priv.id && r.body.createdByName === 'Alice Arora', JSON.stringify(r.body));
r = await call('POST', `/contests/${priv.id}/join`, { teamIds: [b1] }, B);
check('private join without code → 403', r.status === 403);
r = await call('POST', `/contests/${priv.id}/join`, { teamIds: [b1], inviteCode: priv.inviteCode }, B);
check('private join with code', r.status === 201 && r.body.contest.filledSpots === 2 && r.body.contest.inviteCode === priv.inviteCode);
r = await call('GET', `/contests/invite/ZZZZZZZZ`, null, C);
check('unknown code → 404', r.status === 404);
r = await call('GET', `/contests/invite/bad`, null, C);
check('malformed code → 400', r.status === 400);
r = await call('GET', `/matches/${m1.id}/contests`, null, B);
check('private listed only for members', r.body.myPrivate.some((c) => c.id === priv.id) && !r.body.contests.some((c) => c.id === priv.id));
r = await call('GET', `/matches/${m1.id}/contests`, null, C);
check('non-member does not see private contest', !r.body.myPrivate.some((c) => c.id === priv.id));

// My Matches
r = await call('GET', '/me/matches?status=UPCOMING', null, A);
const mine = r.body.find((x) => x.match.id === m1.id);
check('my matches lists joined match with counts', mine && mine.contestsJoined === 4 && mine.teamsCreated === 3, JSON.stringify(mine));
check('my matches card shows the real open-contest count', mine.match.contestCount >= 5, String(mine?.match.contestCount));
r = await call('GET', `/contests/${mega.id}`, null, C);
check('Hindi name stored and returned intact', r.body.leaderboard !== undefined && (await call('GET', '/me', null, C)).body.name === 'राहुल शर्मा');

// Paid gate: a paid contest inserted directly is invisible and unjoinable while paid play is off.
const paid = await prisma.contest.create({
  data: { matchId: m1.id, type: 'PUBLIC', name: 'Test Paid ₹49', entryFeeX100: 4900, prizePoolX100: 100000, currency: 'INR', totalSpots: 100, maxEntriesPerUser: 1 },
});
try {
  r = await call('GET', `/matches/${m1.id}/contests`, null, A);
  check('paid contest hidden from list', !r.body.contests.some((c) => c.id === paid.id));
  r = await call('GET', `/contests/${paid.id}`, null, A);
  check('paid contest detail hidden', r.status === 404);
  r = await call('POST', `/contests/${paid.id}/join`, { teamIds: [a1] }, A);
  check('paid join refused (403)', r.status === 403 && /Paid contests are not available/.test(r.body.message), JSON.stringify(r.body));
} finally {
  await prisma.contest.deleteMany({ where: { id: { in: [paid.id, ...fixtures] } } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
