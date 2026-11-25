import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider } from './mock.provider';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 21, 6, 0); // 21 Oct 2026, 06:00 UTC
const window = (now: number) => [new Date(now - 3 * DAY), new Date(now + 7 * DAY)] as const;

test('fixtures are deterministic across calls', async () => {
  const p = new MockProvider(() => NOW);
  const a = await p.fetchFixtures(...window(NOW));
  const b = await p.fetchFixtures(...window(NOW));
  assert.deepEqual(a, b);
  assert.ok(a.filter((f) => f.format === 'T20').length >= 27);
});

test('hourly Blitz T10s are listed only near now', async () => {
  const fixtures = await new MockProvider(() => NOW).fetchFixtures(...window(NOW));
  const blitz = fixtures.filter((f) => f.format === 'T10');
  assert.ok(blitz.length >= 7 && blitz.length <= 8, `got ${blitz.length}`);
  for (const f of blitz) {
    assert.ok(Math.abs(f.startTime.getTime() - NOW) <= 4 * 3_600_000);
    assert.equal(f.startTime.getUTCMinutes(), 0);
  }
});

test('statuses follow the clock and a team never plays itself', async () => {
  const fixtures = await new MockProvider(() => NOW).fetchFixtures(...window(NOW));
  for (const f of fixtures) {
    assert.notEqual(f.home.externalId, f.away.externalId);
    if (f.startTime.getTime() > NOW) assert.equal(f.status, 'UPCOMING');
    else assert.ok(['LIVE', 'COMPLETED', 'ABANDONED'].includes(f.status));
  }
  assert.ok(fixtures.some((f) => f.status === 'LIVE'), 'the 04:30 UTC T20 should be live at 06:00 UTC');
});

test('a Blitz goes UPCOMING → LIVE (scores rising) → COMPLETED with a result', async () => {
  const start = Date.UTC(2026, 9, 21, 7, 0);
  const id = `mock-blitz-${start / 3_600_000}`;
  const at = (ms: number) => new MockProvider(() => ms);

  assert.equal(await at(start - 60_000).fetchLive(id), null);

  let lastRuns = -1;
  let lastBalls = -1;
  for (let m = 1; m <= 16; m += 3) {
    const live = await at(start + m * 60_000).fetchLive(id);
    if (!live || live.status === 'ABANDONED') return; // 4% of fixtures are rained off — nothing to check
    const runs = live.innings.reduce((s, i) => s + i.runs, 0);
    const balls = live.innings.reduce((s, i) => s + i.balls, 0);
    assert.ok(runs >= lastRuns && balls >= lastBalls, 'scores never go backwards');
    lastRuns = runs;
    lastBalls = balls;
  }
  const done = await at(start + 25 * 60_000).fetchLive(id);
  assert.equal(done?.status, 'COMPLETED');
  assert.equal(done?.final, true);
  assert.match(done!.statusNote!, /won by|tied/);
});

test('final scorecard is internally consistent', async () => {
  const p = new MockProvider(() => NOW + 2 * DAY);
  const fixtures = await p.fetchFixtures(new Date(NOW - 2 * DAY), new Date(NOW));
  let checked = 0;
  for (const f of fixtures.filter((x) => x.status === 'COMPLETED')) {
    const live = (await p.fetchLive(f.externalId))!;
    const [i1, i2] = live.innings;
    assert.ok(i1 && i2);
    const overs = f.format === 'T10' ? 10 : 20;
    for (const inn of live.innings) {
      assert.ok(inn.wickets <= 10 && inn.balls <= overs * 6, `${f.externalId} innings within limits`);
    }
    // Chasing side stops as soon as it passes the target.
    if (i2.runs > i1.runs) assert.ok(i2.runs - i1.runs <= 6, 'chase stops at the winning ball');

    const stats = Object.values(live.players);
    assert.equal(stats.length, 22, 'two playing XIs');
    const batRuns = stats.reduce((s, x) => s + x.runs, 0);
    const conceded = stats.reduce((s, x) => s + x.runsConceded, 0);
    assert.equal(conceded, i1.runs + i2.runs, 'bowlers concede every run (wides included)');
    assert.ok(batRuns <= conceded, 'batter runs exclude wides');
    const bowled = stats.reduce((s, x) => s + x.ballsBowled, 0);
    assert.equal(bowled, i1.balls + i2.balls);
    const outs = stats.filter((x) => x.out).length;
    assert.equal(outs, i1.wickets + i2.wickets);
    const credited = stats.reduce((s, x) => s + x.wickets + x.runOutDirect + x.runOutIndirect, 0);
    assert.equal(credited, outs, 'every dismissal is credited to a bowler or a run-out fielder');
    checked++;
  }
  assert.ok(checked >= 5, `checked ${checked} matches`);
});

test('squads: 18 per side, prices stable when lineups land, XI shape correct', async () => {
  const fixtures = await new MockProvider(() => NOW).fetchFixtures(new Date(NOW), new Date(NOW + 2 * DAY));
  const f = fixtures.find((x) => x.status === 'UPCOMING' && x.format === 'T20')!;
  const early = await new MockProvider(() => f.startTime.getTime() - 3 * 3_600_000).fetchSquads(f.externalId);
  const late = await new MockProvider(() => f.startTime.getTime() - 10 * 60_000).fetchSquads(f.externalId);
  for (const [i, side] of early.entries()) {
    assert.equal(side.players.length, 18);
    assert.ok(side.players.every((p) => p.isPlaying === null));
    assert.deepEqual(
      side.players.map((p) => p.credits),
      late[i]!.players.map((p) => p.credits),
      'prices do not move when lineups are announced',
    );
    const xi = late[i]!.players.filter((p) => p.isPlaying);
    const count = (r: string) => xi.filter((p) => p.role === r).length;
    assert.deepEqual([xi.length, count('WK'), count('BAT'), count('AR'), count('BOWL')], [11, 1, 4, 2, 4]);
  }
});

test('live player stats only cover the announced XI', async () => {
  const fixtures = await new MockProvider(() => NOW).fetchFixtures(...window(NOW));
  const live = fixtures.find((f) => f.status === 'LIVE')!;
  const p = new MockProvider(() => NOW);
  const squads = await p.fetchSquads(live.externalId);
  const xi = new Set(squads.flatMap((s) => s.players.filter((x) => x.isPlaying).map((x) => x.externalId)));
  const state = (await p.fetchLive(live.externalId))!;
  assert.deepEqual(new Set(Object.keys(state.players)), xi);
});
