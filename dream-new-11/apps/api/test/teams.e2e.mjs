// End-to-end team checks against a running API in demo mode: npm run test:e2e -w @dream11/api
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

/** Signs up a brand-new phone user so every run starts with zero teams. */
async function newUser() {
  const phone = '7' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  await call('POST', '/auth/otp/request', { phone });
  const v = await call('POST', '/auth/otp/verify', { phone, code: '123456' });
  const r = await call('POST', '/auth/register/phone', { signupToken: v.body.signupToken, name: 'Team Tester', dob: '1995-05-05', acceptTerms: true });
  return r.body.tokens.accessToken;
}

/** Cheapest valid XI: 1 WK, 4 BAT, 2 AR, 4 BOWL, alternating sides so neither exceeds 7. */
function cheapXI(match) {
  const shape = { WK: 1, BAT: 4, AR: 2, BOWL: 4 };
  const [a, b] = match.squads;
  const picked = [];
  for (const [role, n] of Object.entries(shape)) {
    const pool = [...a.players, ...b.players].filter((p) => p.role === role).sort((x, y) => x.credits - y.credits);
    const sides = { [a.team.id]: 0, [b.team.id]: 0 };
    for (const p of pool) {
      if (picked.filter((q) => q.role === role).length >= n) break;
      if (picked.filter((q) => q.teamId === p.teamId).length >= 6) continue;
      picked.push(p);
      sides[p.teamId]++;
    }
  }
  return picked;
}

const body = (matchId, xi, c = 0, vc = 1) => ({ matchId, playerIds: xi.map((p) => p.id), captainId: xi[c].id, viceCaptainId: xi[vc].id });

const token = await newUser();
const feed = await call('GET', '/matches/feed?sport=cricket', null, token);
const upcoming = feed.body.upcoming.filter((m) => Date.parse(m.startTime) > Date.now() + 10 * 60_000);
const matchId = upcoming[0].id;

let r = await call('GET', '/fantasy/rules?sport=cricket', null, token);
check('rules', r.status === 200 && r.body.teamSize === 11 && r.body.maxCredits === 100 && r.body.maxTeamsPerMatch === 6, JSON.stringify(r.body));

r = await call('GET', `/matches/${matchId}/builder`, null, token);
check('builder', r.status === 200 && r.body.editable === true && r.body.match.squads.length === 2 && r.body.myTeams.length === 0);
const match = r.body.match;
const xi = cheapXI(match);
check('test XI has 11 players', xi.length === 11, String(xi.length));

r = await call('POST', '/teams', body(matchId, xi), token);
check('create T1', r.status === 201 && r.body.name === 'T1' && r.body.players.length === 11, JSON.stringify(r.body));
const t1 = r.body;
check('credits computed server-side', Math.abs(t1.credits - xi.reduce((s, p) => s + p.credits, 0)) < 0.01);

r = await call('POST', '/teams', body(matchId, xi), token);
check('identical team rejected 409', r.status === 409 && /T1/.test(r.body.message), JSON.stringify(r.body));

r = await call('POST', '/teams', body(matchId, xi, 1, 0), token);
check('same XI, swapped C/VC is allowed (T2)', r.status === 201 && r.body.name === 'T2', JSON.stringify(r.body));

// Rule violations
r = await call('POST', '/teams', body(matchId, xi.slice(0, 10)), token);
check('10 players rejected', r.status === 400 && r.body.fields?.TEAM_SIZE, JSON.stringify(r.body));

const allPlayers = [...match.squads[0].players, ...match.squads[1].players];
// Swap two of the four bowlers for batters: 6 BAT is allowed, but 2 BOWL is below the minimum of 3.
const extraBats = allPlayers.filter((p) => p.role === 'BAT' && !xi.some((q) => q.id === p.id)).slice(0, 2);
const bowlers = xi.filter((q) => q.role === 'BOWL').slice(0, 2);
const twoBowlers = xi.map((p) => (bowlers.includes(p) ? extraBats[bowlers.indexOf(p)] : p));
r = await call('POST', '/teams', body(matchId, twoBowlers, 0, 1), token);
check('role minimum enforced', r.status === 400 && r.body.fields?.ROLE_MIN, JSON.stringify(r.body));

const sideA = match.squads[0].players;
const eightFromA = [
  ...sideA.filter((p) => p.role === 'WK').slice(0, 1),
  ...sideA.filter((p) => p.role === 'BAT').slice(0, 3),
  ...sideA.filter((p) => p.role === 'AR').slice(0, 1),
  ...sideA.filter((p) => p.role === 'BOWL').slice(0, 3),
  ...match.squads[1].players.filter((p) => p.role === 'BAT').slice(0, 1),
  ...match.squads[1].players.filter((p) => p.role === 'AR').slice(0, 1),
  ...match.squads[1].players.filter((p) => p.role === 'BOWL').slice(0, 1),
];
r = await call('POST', '/teams', body(matchId, eightFromA), token);
check('max 7 per side enforced', r.status === 400 && r.body.fields?.MAX_PER_TEAM, JSON.stringify(r.body));

const priciest = [...allPlayers].sort((x, y) => y.credits - x.credits);
const rich = cheapXI({ squads: match.squads.map((s) => ({ ...s, players: s.players.map((p) => ({ ...p, credits: -p.credits })) })) }).map(
  (p) => allPlayers.find((q) => q.id === p.id),
);
const richCredits = rich.reduce((s, p) => s + p.credits, 0);
r = await call('POST', '/teams', body(matchId, rich), token);
check(`budget enforced (${richCredits.toFixed(1)} credits)`, richCredits > 100 ? r.status === 400 && r.body.fields?.CREDITS : r.status !== 500, JSON.stringify(r.body));
void priciest;

r = await call('POST', '/teams', { ...body(matchId, xi), captainId: 'not-in-team' }, token);
check('captain must be in team', r.status === 400 && r.body.fields?.CAPTAIN, JSON.stringify(r.body));
r = await call('POST', '/teams', { ...body(matchId, xi), viceCaptainId: xi[0].id }, token);
check('captain ≠ vice-captain', r.status === 400 && r.body.fields?.SAME_LEADER, JSON.stringify(r.body));

// Upcoming matches can share a side, so pick a player who is genuinely not in this match.
const inMatch = new Set(allPlayers.map((p) => p.id));
let foreign;
for (const m of upcoming.slice(1)) {
  const squads = (await call('GET', `/matches/${m.id}`, null, token)).body.squads;
  foreign = squads.flatMap((sq) => sq.players).find((p) => !inMatch.has(p.id));
  if (foreign) break;
}
r = await call('POST', '/teams', body(matchId, [...xi.slice(0, 10), foreign]), token);
check('player from another match rejected', r.status === 400 && /squad/.test(r.body.message), JSON.stringify(r.body));

// Edit keeps the team number
const swapIn = allPlayers.find((p) => p.role === xi[3].role && !xi.some((q) => q.id === p.id) && p.teamId === xi[3].teamId);
const edited = xi.map((p, i) => (i === 3 ? swapIn : p));
r = await call('PUT', `/teams/${t1.id}`, { playerIds: edited.map((p) => p.id), captainId: edited[0].id, viceCaptainId: edited[1].id }, token);
check('edit T1', r.status === 200 && r.body.name === 'T1' && r.body.players.some((p) => p.id === swapIn.id), JSON.stringify(r.body));

// Team limit (6) under concurrency: 2 exist, fire 6 more at once — exactly 4 must succeed.
const variants = [2, 3, 4, 5, 6, 7].map((c) => body(matchId, xi, c, 0));
const results = await Promise.all(variants.map((v) => call('POST', '/teams', v, token)));
const created = results.filter((x) => x.status === 201).length;
const limited = results.filter((x) => x.status === 409 && /up to 6/.test(x.body.message)).length;
check('concurrent creates respect 6-team limit', created === 4 && limited === 2, results.map((x) => x.status).join(','));
r = await call('GET', `/teams?matchId=${matchId}`, null, token);
check('exactly 6 teams, numbered T1–T6', r.body.length === 6 && r.body.map((t) => t.teamNumber).join() === '1,2,3,4,5,6', r.body.map((t) => t.name).join());

// Selection %
r = await call('GET', `/matches/${matchId}/builder`, null, token);
const sel = r.body.selection[xi[0].id];
check('selection % reported', sel && sel.selectedBy > 0 && sel.selectedBy <= 100, JSON.stringify(sel));

// Grouped list + single fetch + ownership
r = await call('GET', '/teams', null, token);
check('grouped list', r.status === 200 && r.body[0].match.id === matchId && r.body[0].teams.length === 6);
r = await call('GET', `/teams/${t1.id}`, null, token);
check('get team with match', r.status === 200 && r.body.match.id === matchId && r.body.editable === true);
const intruder = await newUser();
r = await call('GET', `/teams/${t1.id}`, null, intruder);
check("other user can't read my team", r.status === 404);
r = await call('PUT', `/teams/${t1.id}`, { playerIds: xi.map((p) => p.id), captainId: xi[0].id, viceCaptainId: xi[1].id }, intruder);
check("other user can't edit my team", r.status === 404);

// Deadline lock
const done = feed.body.completed[0];
const doneMatch = (await call('GET', `/matches/${done.id}`, null, token)).body;
if (doneMatch.squads[0].players.length) {
  r = await call('POST', '/teams', body(done.id, cheapXI(doneMatch)), token);
  check('completed match is locked (403)', r.status === 403, JSON.stringify(r.body));
}
r = await call('POST', '/teams', body(matchId, xi), null);
check('auth required', r.status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
