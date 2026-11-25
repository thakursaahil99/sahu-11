/**
 * Integration test for the live pipeline against the real database, with a controllable clock:
 * provider scorecard → player points → team points (C/VC) → ranks (ties) → deltas → settlement.
 * Uses a Blitz fixture from January 2026 so it never overlaps with what the running API polls.
 *
 *   npm run test:int -w @dream11/api
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DEFAULT_CRICKET_RULES, DEFAULT_T10_SCORING, rankAndPrizes, scorePlayer, teamPointsX10 } from '@dream11/shared';
import { AuditService } from '../src/audit/audit.service';
import { loadEnv } from '../src/config/env';
import { NotificationEvents } from '../src/notifications/notification-events';
import { NotificationsService } from '../src/notifications/notifications.service';
import { LogPushProvider } from '../src/notifications/push.provider';
import { ResponsiblePlayService } from '../src/responsible-play/responsible-play.service';
import { LiveScoringService } from '../src/live/live-scoring.service';
import { ScoringConfigService } from '../src/live/scoring-config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockProvider } from '../src/sports/providers/mock.provider';
import { LedgerService } from '../src/wallet/ledger.service';
import { WalletService } from '../src/wallet/wallet.service';
import { JwtService } from '@nestjs/jwt';
import { FantasyConfigService } from '../src/teams/fantasy-config.service';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 0, 6, 9, 0);
const EXTERNAL_ID = `mock-blitz-${START / HOUR}`;

let pass = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  pass++;
  console.log(`PASS  ${name}`);
};

const env = loadEnv();
const prisma = new PrismaService();
let now = START - HOUR;
const provider = new MockProvider(() => now);
const emits: { room: string; event: string; payload: { changes?: { entryId: string }[]; status?: string } }[] = [];
const gateway = { emit: (room: string, event: string, payload: never) => emits.push({ room, event, payload }) };
const fantasy = new FantasyConfigService(prisma);
const audit = new AuditService(prisma);
const notifications = new NotificationsService(prisma, new LogPushProvider());
const events = new NotificationEvents(prisma, notifications, env);
const play = new ResponsiblePlayService(prisma, audit, env);
const wallet = new WalletService(prisma, new LedgerService(prisma, audit), audit, new JwtService(), null, play, events, env);
const live = new LiveScoringService(
  prisma,
  provider,
  new ScoringConfigService(prisma),
  fantasy,
  gateway as never,
  new AuditService(prisma),
  wallet,
  events,
  env,
);

const created = { users: [] as string[], match: '' };

async function main() {
  await prisma.$connect();
  const sport = await prisma.sport.findUniqueOrThrow({ where: { key: 'cricket' } });

  // Fixture + squad as the sync job would write them.
  const [fixture] = (await provider.fetchFixtures(new Date(START - 1), new Date(START + 1))).filter((f) => f.externalId === EXTERNAL_ID);
  assert.ok(fixture, 'fixture exists');
  now = START - 5 * 60_000; // lineups are out
  const squads = await provider.fetchSquads(EXTERNAL_ID);
  const teamRows = await prisma.team.findMany({ where: { provider: 'mock', externalId: { in: [fixture.home.externalId, fixture.away.externalId] } } });
  const series = await prisma.series.upsert({
    where: { provider_externalId: { provider: 'mock', externalId: 'mock-blitz' } },
    create: { provider: 'mock', externalId: 'mock-blitz', sportId: sport.id, name: 'Blitz T10 Showdown', format: 'T10' },
    update: {},
  });
  const teamId = (ext: string) => teamRows.find((t) => t.externalId === ext)!.id;
  await prisma.match.deleteMany({ where: { provider: 'mock', externalId: EXTERNAL_ID } });
  const match = await prisma.match.create({
    data: {
      provider: 'mock',
      externalId: EXTERNAL_ID,
      sportId: sport.id,
      seriesId: series.id,
      homeTeamId: teamId(fixture.home.externalId),
      awayTeamId: teamId(fixture.away.externalId),
      venue: fixture.venue,
      format: 'T10',
      startTime: new Date(START),
      status: 'UPCOMING',
      lineupsAnnounced: true,
    },
  });
  created.match = match.id;

  const players = await prisma.player.findMany({ where: { provider: 'mock', externalId: { in: squads.flatMap((s) => s.players.map((p) => p.externalId)) } } });
  const pid = new Map(players.map((p) => [p.externalId, p.id]));
  const ext = new Map(players.map((p) => [p.id, p.externalId]));
  await prisma.matchPlayer.createMany({
    data: squads.flatMap((s) =>
      s.players.map((p) => ({
        matchId: match.id,
        playerId: pid.get(p.externalId)!,
        teamId: teamId(s.team.externalId),
        role: p.role,
        creditsX10: Math.round(p.credits * 10),
        isPlaying: p.isPlaying,
      })),
    ),
  });

  // Three users. A and B have identical teams (guaranteed tie); C differs.
  const xi = squads.flatMap((s) => s.players.filter((p) => p.isPlaying).map((p) => ({ ...p, side: teamId(s.team.externalId) })));
  const homeXI = xi.filter((p) => p.side === teamId(fixture.home.externalId));
  const awayXI = xi.filter((p) => p.side === teamId(fixture.away.externalId));
  const pickTeam = (variant: number) => {
    // 6 from home + 5 from away keeps every role inside its limits for the 1/4/2/4 XIs.
    const chosen = [...homeXI.slice(0, 6), ...awayXI.slice(variant, variant + 5)];
    return { ids: chosen.map((p) => pid.get(p.externalId)!), roles: chosen.map((p) => p.role), sides: chosen.map((p) => p.side), credits: chosen.map((p) => p.credits) };
  };

  const contest = await prisma.contest.create({
    data: {
      matchId: match.id,
      type: 'FREE',
      name: 'Live int test',
      status: 'LOCKED',
      totalSpots: 10,
      maxEntriesPerUser: 1,
      guaranteed: true,
      currency: 'DEMO',
      prizePoolX100: 18000,
      prizeBreakup: [
        { fromRank: 1, toRank: 1, amountX100: 10000 },
        { fromRank: 2, toRank: 2, amountX100: 5000 },
        { fromRank: 3, toRank: 3, amountX100: 3000 },
      ],
    },
  });

  const entries: { user: string; team: string; entry: string; ids: string[]; c: string; vc: string }[] = [];
  for (const [i, variant] of [0, 0, 1].entries()) {
    const t = pickTeam(variant);
    const user = await prisma.user.create({
      data: { name: `Live Tester ${i}`, dob: new Date('1990-01-01'), referralCode: `LIVEINT${Date.now()}${i}`, termsAcceptedAt: new Date() },
    });
    created.users.push(user.id);
    const c = t.ids[0]!;
    const vc = t.ids[6]!;
    const team = await prisma.userTeam.create({
      data: {
        userId: user.id,
        matchId: match.id,
        teamNumber: 1,
        captainId: c,
        viceCaptainId: vc,
        creditsX10: Math.round(t.credits.reduce((s, x) => s + x, 0) * 10),
        signature: `live-int-${i}-${Date.now()}`,
        players: { create: t.ids.map((playerId, k) => ({ playerId, sideTeamId: t.sides[k]!, role: t.roles[k]!, creditsX10: Math.round(t.credits[k]! * 10) })) },
      },
    });
    const entry = await prisma.contestEntry.create({ data: { contestId: contest.id, userId: user.id, teamId: team.id } });
    entries.push({ user: user.id, team: team.id, entry: entry.id, ids: t.ids, c, vc });
  }
  await prisma.contest.update({ where: { id: contest.id }, data: { filledSpots: 3 } });

  /** Expected team points straight from the shared engine. */
  const expected = async () => {
    const state = (await provider.fetchLive(EXTERNAL_ID))!;
    const roles = new Map(squads.flatMap((s) => s.players.map((p) => [pid.get(p.externalId)!, p.role] as const)));
    const base = new Map<string, number>();
    for (const [id, role] of roles) {
      const stats = state.players[ext.get(id)!];
      base.set(id, stats ? scorePlayer(stats, role, DEFAULT_T10_SCORING).total : 0);
    }
    return entries.map((e) => teamPointsX10(e.ids, e.c, e.vc, base, DEFAULT_CRICKET_RULES.captainMultiplier, DEFAULT_CRICKET_RULES.viceCaptainMultiplier));
  };
  const readEntries = () => prisma.contestEntry.findMany({ where: { contestId: contest.id }, orderBy: { id: 'asc' } }).then((rows) => entries.map((e) => rows.find((r) => r.id === e.entry)!));

  // ── Reminder (uses the real clock): pretend the match starts in 10 minutes ──
  await prisma.match.update({ where: { id: match.id }, data: { startTime: new Date(Date.now() + 10 * 60_000), status: 'UPCOMING' } });
  await events.remindUpcoming();
  await events.remindUpcoming();
  await new Promise((r) => setTimeout(r, 200));
  const reminders = await prisma.notification.findMany({ where: { userId: { in: created.users }, type: 'MATCH_REMINDER' } });
  ok('one reminder per user with a team, even when the job runs twice', () => {
    assert.equal(reminders.length, created.users.length);
    assert.ok(reminders.every((n) => n.url === `/match/${match.id}` && /Teams lock in/.test(n.body)));
  });
  await prisma.match.update({ where: { id: match.id }, data: { startTime: new Date(START) } });

  // ── Mid-match ──
  now = START + 9 * 60_000;
  await live.processMatch(await prisma.match.findUniqueOrThrow({ where: { id: match.id } }));
  const mid = await readEntries();
  const midExpected = await expected();

  const pointRows = await prisma.playerMatchPoints.count({ where: { matchId: match.id } });
  ok('22 player point rows written', () => assert.equal(pointRows, 22));
  ok('team points equal the shared engine (C 2x, VC 1.5x)', () => assert.deepEqual(mid.map((e) => e.pointsX10), midExpected));
  ok('identical teams tie on rank', () => assert.equal(mid[0]!.rank, mid[1]!.rank));
  ok('ranks follow points', () => {
    const better = mid[0]!.pointsX10 > mid[2]!.pointsX10;
    assert.equal(better ? mid[0]!.rank! < mid[2]!.rank! : mid[0]!.rank! >= mid[2]!.rank!, true);
  });
  const liveMatch = await prisma.match.findUniqueOrThrow({ where: { id: match.id }, include: { liveState: true } });
  ok('match moved to LIVE with a score', () => {
    assert.equal(liveMatch.status, 'LIVE');
    assert.ok(liveMatch.liveState);
  });
  ok('a leaderboard delta and a match event were pushed', () => {
    assert.ok(emits.some((e) => e.room === `contest:${contest.id}` && e.event === 'leaderboard:delta' && e.payload.changes!.length === 3));
    assert.ok(emits.some((e) => e.room === `match:${match.id}` && e.event === 'match:live'));
  });

  // Same clock again → identical scorecard → nothing recomputed or pushed.
  const before = emits.length;
  await live.processMatch(await prisma.match.findUniqueOrThrow({ where: { id: match.id } }));
  ok('unchanged scorecard is skipped (no duplicate pushes)', () => assert.equal(emits.length, before));

  // ── Full time ──
  now = START + 30 * 60_000;
  await live.processMatch(await prisma.match.findUniqueOrThrow({ where: { id: match.id } }));
  const final = await readEntries();
  const finalExpected = await expected();
  const settled = await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } });
  ok('match completed and contest settled', () => {
    assert.equal(settled.status, 'COMPLETED');
    assert.ok(settled.settledAt);
  });
  ok('final points match the engine', () => assert.deepEqual(final.map((e) => e.pointsX10), finalExpected));

  const order = [...final].sort((a, b) => b.pointsX10 - a.pointsX10);
  const prizes = rankAndPrizes(
    order.map((e) => e.pointsX10),
    [
      { fromRank: 1, toRank: 1, amount: 100 },
      { fromRank: 2, toRank: 2, amount: 50 },
      { fromRank: 3, toRank: 3, amount: 30 },
    ],
  );
  ok('tied teams share prizes and winnings are written', () => {
    order.forEach((e, i) => {
      assert.equal(e.rank, prizes[i]!.rank);
      assert.equal(e.winningsX100, Math.round(prizes[i]!.prize * 100));
    });
    assert.equal(final[0]!.winningsX100, final[1]!.winningsX100, 'A and B (tied) win the same');
  });
  ok('contest completion was pushed', () => assert.ok(emits.some((e) => e.event === 'contest:status' && e.payload.status === 'COMPLETED')));

  // Settlement is idempotent.
  const audits = await prisma.auditLog.count({ where: { action: 'contest.settled', entityId: contest.id } });
  await live.processMatch(await prisma.match.findUniqueOrThrow({ where: { id: match.id } }));
  const auditsAfter = await prisma.auditLog.count({ where: { action: 'contest.settled', entityId: contest.id } });
  ok('settlement happens exactly once', () => assert.deepEqual([audits, auditsAfter], [1, 1]));

  const credits = await prisma.walletTransaction.findMany({ where: { reference: contest.id, type: 'CONTEST_WINNING' } });
  ok('demo winnings credited to wallets, once per winning entry', () => {
    const winners = final.filter((e) => e.winningsX100 > 0);
    assert.equal(credits.length, winners.length);
    for (const w of winners) assert.ok(credits.some((c) => c.userId === w.userId && c.amountX100 === w.winningsX100 && c.currency === 'DEMO'));
  });

  // Notifications are delivered in the background; give them a moment.
  const notified = [...new Set(final.map((e) => e.userId))];
  for (let i = 0; i < 30; i++) {
    if ((await prisma.notification.count({ where: { userId: { in: notified }, type: 'CONTEST_RESULT' } })) >= notified.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const notes = await prisma.notification.findMany({ where: { userId: { in: notified } } });
  ok('notification timestamps are UTC (not shifted by the DB session time zone)', () => {
    for (const n of notes) assert.ok(Math.abs(n.createdAt.getTime() - Date.now()) < 120_000, n.createdAt.toISOString());
  });
  ok('match start notified once per player', () => {
    for (const u of notified) assert.equal(notes.filter((n) => n.userId === u && n.type === 'MATCH_START').length, 1);
  });
  ok('result notified once per player; winners see their winnings', () => {
    for (const u of notified) {
      const r = notes.filter((n) => n.userId === u && n.type === 'CONTEST_RESULT');
      assert.equal(r.length, 1);
      const won = final.filter((e) => e.userId === u).reduce((s, e) => s + e.winningsX100, 0);
      assert.equal(r[0]!.title.startsWith('You won'), won > 0, r[0]!.title);
      assert.equal(r[0]!.url, `/contest/${contest.id}`);
    }
  });

  console.log(`\n${pass} passed, 0 failed`);
}

main()
  .catch((err) => {
    console.error('FAIL ', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (created.match) {
      await prisma.contest.deleteMany({ where: { matchId: created.match } });
      await prisma.userTeam.deleteMany({ where: { matchId: created.match } });
      await prisma.match.delete({ where: { id: created.match } }).catch(() => undefined);
    }
    if (created.users.length) {
      await prisma.walletTransaction.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    }
    await prisma.$disconnect();
  });
