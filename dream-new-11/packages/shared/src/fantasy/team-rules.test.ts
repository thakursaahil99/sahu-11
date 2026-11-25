import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlayerRole } from '../types/sports';
import { DEFAULT_CRICKET_RULES as R, PickablePlayer, summarizeTeam, teamSignature, validateTeam, whyCannotAdd } from './team-rules';

let seq = 0;
const p = (role: PlayerRole, credits = 8, teamId = 'A'): PickablePlayer => ({ id: `p${++seq}`, role, credits, teamId });

/** A valid 1 WK / 4 BAT / 2 AR / 4 BOWL team, 6 from A and 5 from B, 88 credits. */
function validXI(): PickablePlayer[] {
  return [
    p('WK', 8, 'A'),
    p('BAT', 8, 'A'),
    p('BAT', 8, 'A'),
    p('BAT', 8, 'B'),
    p('BAT', 8, 'B'),
    p('AR', 8, 'A'),
    p('AR', 8, 'B'),
    p('BOWL', 8, 'A'),
    p('BOWL', 8, 'B'),
    p('BOWL', 8, 'B'),
    p('BOWL', 8, 'A'),
  ];
}

const draft = (players: PickablePlayer[]) => ({ players, captainId: players[0]!.id, viceCaptainId: players[1]!.id });
const codes = (players: PickablePlayer[], c?: string | null, vc?: string | null) =>
  validateTeam({ players, captainId: c === undefined ? players[0]?.id ?? null : c, viceCaptainId: vc === undefined ? players[1]?.id ?? null : vc }, R).map(
    (e) => e.code,
  );

test('a valid XI passes', () => {
  assert.deepEqual(validateTeam(draft(validXI()), R), []);
});

test('credits are summed without float drift', () => {
  const team = Array.from({ length: 10 }, () => p('BAT', 0.1));
  assert.equal(summarizeTeam(team, R).credits, 1);
  assert.equal(summarizeTeam(team, R).creditsLeft, 99);
});

test('over budget is rejected', () => {
  const xi = validXI();
  xi[0] = p('WK', 21, 'A'); // 80 + 21 = 101
  assert.ok(codes(xi, xi[0].id).includes('CREDITS'));
});

test('more than 7 from one side is rejected', () => {
  const xi = validXI().map((pl, i) => ({ ...pl, teamId: i < 8 ? 'A' : 'B' }));
  assert.ok(codes(xi).includes('MAX_PER_TEAM'));
});

test('role min and max are enforced', () => {
  const noWk = validXI().map((pl) => (pl.role === 'WK' ? { ...pl, role: 'BAT' as const } : pl));
  assert.ok(codes(noWk).includes('ROLE_MIN'));
  const sevenBat = validXI().map((pl, i) => (i >= 5 && i <= 7 ? { ...pl, role: 'BAT' as const } : pl));
  assert.ok(codes(sevenBat).includes('ROLE_MAX'));
});

test('captain and vice-captain must be in the team and different', () => {
  const xi = validXI();
  assert.ok(codes(xi, null).includes('CAPTAIN'));
  assert.ok(codes(xi, 'outsider').includes('CAPTAIN'));
  assert.ok(codes(xi, xi[0]!.id, xi[0]!.id).includes('SAME_LEADER'));
});

test('team size and duplicates are enforced', () => {
  assert.ok(codes(validXI().slice(0, 10)).includes('TEAM_SIZE'));
  const xi = validXI();
  assert.ok(codes([...xi.slice(0, 10), xi[0]!]).includes('DUPLICATE_PLAYER'));
});

test('whyCannotAdd: role max, per-team max, credits', () => {
  const four = [p('WK'), p('WK'), p('WK'), p('WK')];
  assert.match(whyCannotAdd(four, p('WK'), R)!, /at most 4/);

  const seven = Array.from({ length: 7 }, (_, i) => p(i < 3 ? 'BAT' : i < 6 ? 'BOWL' : 'WK', 7, 'A'));
  assert.match(whyCannotAdd(seven, p('AR', 7, 'A'), R)!, /Max 7 players from one team/);

  const rich = Array.from({ length: 9 }, (_, i) => p(i === 0 ? 'WK' : i < 4 ? 'BAT' : i < 5 ? 'AR' : 'BOWL', 10.5, i % 2 ? 'A' : 'B'));
  assert.match(whyCannotAdd(rich, p('BAT', 6, 'B'), R)!, /Not enough credits/);
});

test('whyCannotAdd looks ahead to unmet minimums', () => {
  // 7 batters/AR picked, no WK or bowlers yet: 4 slots left and exactly 4 owed (1 WK + 3 BOWL).
  const picked = [p('BAT'), p('BAT'), p('BAT'), p('BAT'), p('AR'), p('AR'), p('AR')].map((pl, i) => ({
    ...pl,
    teamId: i % 2 ? 'A' : 'B',
  }));
  assert.match(whyCannotAdd(picked, p('BAT', 8, 'A'), R)!, /at least/);
  assert.equal(whyCannotAdd(picked, p('BOWL', 8, 'A'), R), null);
});

test('signature ignores order and includes leaders', () => {
  assert.equal(teamSignature(['b', 'a'], 'a', 'b'), teamSignature(['a', 'b'], 'a', 'b'));
  assert.notEqual(teamSignature(['a', 'b'], 'a', 'b'), teamSignature(['a', 'b'], 'b', 'a'));
});
