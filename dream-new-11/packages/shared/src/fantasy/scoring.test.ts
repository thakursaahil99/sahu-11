import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_T10_SCORING as T10, DEFAULT_T20_SCORING as T20, emptyStats, PlayerMatchStats, scorePlayer, teamPointsX10 } from './scoring';

const stats = (s: Partial<PlayerMatchStats>): PlayerMatchStats => ({ ...emptyStats(), inPlayingXI: true, ...s });
const line = (r: ReturnType<typeof scorePlayer>, key: string) => r.lines.find((l) => l.key === key)?.points ?? 0;

test('bench players score nothing', () => {
  assert.equal(scorePlayer({ ...emptyStats(), runs: 50 }, 'BAT', T20).total, 0);
});

test('playing XI bonus alone', () => {
  assert.equal(scorePlayer(stats({}), 'BOWL', T20).total, 4);
});

test('batting: 52 off 30 with 5 fours and 2 sixes', () => {
  const r = scorePlayer(stats({ runs: 52, balls: 30, fours: 5, sixes: 2, out: true }), 'BAT', T20);
  // 4 playing + 52 runs + 5 boundary + 4 six + 8 (50 milestone only) + SR 173.3 → +6
  assert.equal(line(r, 'milestone'), 8);
  assert.equal(line(r, 'strikeRate'), 6);
  assert.equal(r.total, 4 + 52 + 5 + 4 + 8 + 6);
});

test('only the highest milestone counts', () => {
  const r = scorePlayer(stats({ runs: 104, balls: 60 }), 'BAT', T20);
  assert.equal(line(r, 'milestone'), 16);
  assert.equal(r.lines.filter((l) => l.key === 'milestone').length, 1);
});

test('duck applies to batters but not bowlers', () => {
  assert.equal(line(scorePlayer(stats({ runs: 0, balls: 3, out: true }), 'BAT', T20), 'duck'), -2);
  assert.equal(line(scorePlayer(stats({ runs: 0, balls: 3, out: true }), 'BOWL', T20), 'duck'), 0);
  assert.equal(line(scorePlayer(stats({ runs: 0, balls: 0, out: false }), 'BAT', T20), 'duck'), 0);
});

test('strike rate needs the minimum balls and skips bowlers', () => {
  assert.equal(line(scorePlayer(stats({ runs: 3, balls: 9 }), 'BAT', T20), 'strikeRate'), 0);
  assert.equal(line(scorePlayer(stats({ runs: 4, balls: 10 }), 'BAT', T20), 'strikeRate'), -6); // SR 40
  assert.equal(line(scorePlayer(stats({ runs: 4, balls: 10 }), 'BOWL', T20), 'strikeRate'), 0);
});

test('slab boundaries are half-open', () => {
  // SR exactly 150 → 150–170 band (+4), exactly 130 → 130–150 band (+2)
  assert.equal(line(scorePlayer(stats({ runs: 15, balls: 10 }), 'BAT', T20), 'strikeRate'), 4);
  assert.equal(line(scorePlayer(stats({ runs: 13, balls: 10 }), 'BAT', T20), 'strikeRate'), 2);
});

test('bowling: 4-2-20-4 with 2 bowled/LBW and a maiden', () => {
  const r = scorePlayer(stats({ ballsBowled: 24, runsConceded: 20, wickets: 4, lbwBowled: 2, maidens: 1 }), 'BOWL', T20);
  // 4 + 100 wkts + 16 lbw/bowled + 8 (4-wkt haul) + 12 maiden + econ 5.0 → +4
  assert.equal(line(r, 'wicketHaul'), 8);
  assert.equal(line(r, 'economy'), 4);
  assert.equal(r.total, 4 + 100 + 16 + 8 + 12 + 4);
});

test('economy needs minimum balls', () => {
  assert.equal(line(scorePlayer(stats({ ballsBowled: 11, runsConceded: 30 }), 'BOWL', T20), 'economy'), 0);
  assert.equal(line(scorePlayer(stats({ ballsBowled: 12, runsConceded: 30 }), 'BOWL', T20), 'economy'), -6); // 15.0
});

test('fielding including 3-catch bonus', () => {
  const r = scorePlayer(stats({ catches: 3, stumpings: 1, runOutDirect: 1, runOutIndirect: 1 }), 'WK', T20);
  assert.equal(r.total, 4 + 24 + 4 + 12 + 12 + 6);
});

test('T10 uses its own thresholds', () => {
  assert.equal(line(scorePlayer(stats({ ballsBowled: 12, runsConceded: 13 }), 'BOWL', T10), 'economy'), 6); // 6.5 < 7
  assert.equal(line(scorePlayer(stats({ wickets: 2 }), 'BOWL', T10), 'wicketHaul'), 8);
});

test('team points apply 2x / 1.5x and keep halves as tenths', () => {
  const base = new Map([
    ['c', 31],
    ['vc', 11],
    ['x', 7],
  ]);
  // 31*2 + 11*1.5 + 7 = 62 + 16.5 + 7 = 85.5 → 855
  assert.equal(teamPointsX10(['c', 'vc', 'x'], 'c', 'vc', base, 2, 1.5), 855);
});
