import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Match, Prisma } from '@prisma/client';
import {
  contestRoom,
  ContestStatusEvent,
  InningsDto,
  LeaderboardChange,
  LeaderboardDeltaEvent,
  LIVE_EVENTS,
  LiveScoreDto,
  MatchLiveEvent,
  matchRoom,
  rankAndPrizes,
  scorePlayer,
} from '@dream11/shared';
import { AuditService } from '../audit/audit.service';
import { Env, InjectEnv } from '../config/config.module';
import { parseBreakup } from '../contests/contest.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationEvents } from '../notifications/notification-events';
import { ProviderLiveState, SPORTS_PROVIDER, SportsProvider } from '../sports/providers/sports-provider';
import { FantasyConfigService } from '../teams/fantasy-config.service';
import { LiveGateway } from './live.gateway';
import { ScoringConfigService } from './scoring-config.service';

/** Only matches that started within this window are polled. */
const LOOKBACK_MS = 2 * 86_400_000;
const MAX_MATCHES_PER_TICK = 20;

const oversText = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

interface EntrySnapshot {
  id: string;
  contestId: string;
  pointsX10: number;
  rank: number | null;
}

/**
 * Live pipeline: provider scorecard → player points → team points → contest entry points and
 * ranks → Socket.IO deltas. When the provider reports a final result, contests are settled:
 * final ranks with tie-sharing and winnings are written, credited to wallets and notified.
 */
@Injectable()
export class LiveScoringService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LiveScoringService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SPORTS_PROVIDER) private readonly provider: SportsProvider,
    private readonly scoring: ScoringConfigService,
    private readonly fantasy: FantasyConfigService,
    private readonly gateway: LiveGateway,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
    private readonly events: NotificationEvents,
    @InjectEnv() private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.LIVE_SCORING_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), this.env.LIVE_POLL_SECONDS * 1000);
    void this.tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = new Date();
      const matches = await this.prisma.match.findMany({
        where: {
          provider: this.provider.name,
          startTime: { lte: now, gte: new Date(now.getTime() - LOOKBACK_MS) },
          OR: [{ liveState: null }, { liveState: { final: false } }, { contests: { some: { status: 'LOCKED' } } }],
        },
        orderBy: { startTime: 'desc' },
        take: MAX_MATCHES_PER_TICK,
      });
      for (const m of matches) {
        try {
          await this.processMatch(m);
        } catch (err) {
          this.logger.error(`Live update for ${m.externalId} failed: ${err instanceof Error ? err.stack : String(err)}`);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  /** Public for tests and admin "recompute" actions. */
  async processMatch(match: Match): Promise<void> {
    const live = await this.provider.fetchLive(match.externalId);
    if (!live) return;

    const hash = createHash('sha1').update(JSON.stringify(live)).digest('hex');
    const prev = await this.prisma.matchLiveState.findUnique({ where: { matchId: match.id }, select: { hash: true } });
    const unsettled = await this.prisma.contest.count({ where: { matchId: match.id, status: 'LOCKED' } });
    if (prev?.hash === hash && !(live.final && unsettled > 0)) return;

    const score = await this.writeScore(match, live, hash);
    const deltas = await this.recomputeEntries(match);

    for (const [contestId, changes] of deltas) {
      const event: LeaderboardDeltaEvent = { contestId, changes, at: new Date().toISOString() };
      this.gateway.emit(contestRoom(contestId), LIVE_EVENTS.leaderboard, event);
    }
    const matchEvent: MatchLiveEvent = { matchId: match.id, status: live.status, statusNote: live.statusNote, score, at: new Date().toISOString() };
    this.gateway.emit(matchRoom(match.id), LIVE_EVENTS.match, matchEvent);

    // `match` is the row from before this update, so this fires on the first live tick only.
    if (live.status === 'LIVE' && match.status !== 'LIVE') void this.events.matchStarted(match.id).catch(this.events.logError);
    if (live.final && live.status === 'COMPLETED') await this.settle(match.id);
    if (live.final && live.status === 'ABANDONED') await this.cancelAll(match.id, 'Match abandoned');
  }

  /** Stores the scorecard and every player's base points; returns the score DTO for broadcasting. */
  private async writeScore(match: Match, live: ProviderLiveState, hash: string): Promise<LiveScoreDto> {
    const p = this.provider.name;
    const externalIds = Object.keys(live.players);
    const [players, squad, teams, rules] = await Promise.all([
      this.prisma.player.findMany({ where: { provider: p, externalId: { in: externalIds } }, select: { id: true, externalId: true, role: true } }),
      this.prisma.matchPlayer.findMany({ where: { matchId: match.id }, select: { playerId: true, role: true } }),
      this.prisma.team.findMany({
        where: { provider: p, externalId: { in: live.innings.map((i) => i.battingTeamExternalId) } },
        select: { id: true, externalId: true, shortName: true },
      }),
      this.scoring.rulesFor(match.sportId, match.format),
    ]);
    const matchRole = new Map(squad.map((s) => [s.playerId, s.role]));
    const teamBy = new Map(teams.map((t) => [t.externalId, t]));

    const rows: Prisma.PlayerMatchPointsCreateManyInput[] = players.map((pl) => {
      const result = scorePlayer(live.players[pl.externalId]!, matchRole.get(pl.id) ?? pl.role, rules);
      return {
        matchId: match.id,
        playerId: pl.id,
        stats: live.players[pl.externalId] as unknown as Prisma.InputJsonObject,
        pointsX10: result.total * 10,
        breakdown: result.lines as unknown as Prisma.InputJsonArray,
      };
    });

    const innings: InningsDto[] = live.innings.map((i) => ({
      teamId: teamBy.get(i.battingTeamExternalId)?.id ?? '',
      teamShortName: teamBy.get(i.battingTeamExternalId)?.shortName ?? i.battingTeamExternalId,
      runs: i.runs,
      wickets: i.wickets,
      balls: i.balls,
      overs: oversText(i.balls),
      target: i.target,
    }));
    const state = { innings, recentBalls: live.recentBalls };

    await this.prisma.$transaction([
      this.prisma.matchLiveState.upsert({
        where: { matchId: match.id },
        create: { matchId: match.id, state: state as unknown as Prisma.InputJsonObject, hash, final: live.final },
        update: { state: state as unknown as Prisma.InputJsonObject, hash, final: live.final },
      }),
      this.prisma.playerMatchPoints.deleteMany({ where: { matchId: match.id } }),
      this.prisma.playerMatchPoints.createMany({ data: rows }),
      this.prisma.match.update({ where: { id: match.id }, data: { status: live.status, statusNote: live.statusNote } }),
    ]);
    return { innings, recentBalls: live.recentBalls, final: live.final, updatedAt: new Date().toISOString() };
  }

  /**
   * Team points (with C/VC multipliers) and live ranks, computed set-wise in SQL so it scales
   * with the number of teams. Returns per-contest changes for the leaderboard deltas.
   */
  private async recomputeEntries(match: Match): Promise<Map<string, LeaderboardChange[]>> {
    const cfg = await this.fantasy.forSport(match.sportId);
    const before = await this.snapshot(match.id);

    await this.prisma.$executeRaw`
      UPDATE "UserTeam" t SET "pointsX10" = s.pts
      FROM (
        SELECT ut.id,
               COALESCE(SUM(ROUND(COALESCE(pmp."pointsX10", 0) *
                 CASE WHEN utp."playerId" = ut."captainId" THEN ${cfg.captainMultiplier}::numeric
                      WHEN utp."playerId" = ut."viceCaptainId" THEN ${cfg.viceCaptainMultiplier}::numeric
                      ELSE 1 END)), 0)::int AS pts
        FROM "UserTeam" ut
        JOIN "UserTeamPlayer" utp ON utp."teamId" = ut.id
        LEFT JOIN "PlayerMatchPoints" pmp ON pmp."matchId" = ut."matchId" AND pmp."playerId" = utp."playerId"
        WHERE ut."matchId" = ${match.id}
        GROUP BY ut.id
      ) s
      WHERE t.id = s.id AND t."pointsX10" IS DISTINCT FROM s.pts`;

    await this.prisma.$executeRaw`
      UPDATE "ContestEntry" e SET "pointsX10" = t."pointsX10"
      FROM "UserTeam" t, "Contest" c
      WHERE e."teamId" = t.id AND e."contestId" = c.id AND c."matchId" = ${match.id}
        AND c.status = 'LOCKED' AND e."pointsX10" IS DISTINCT FROM t."pointsX10"`;

    await this.prisma.$executeRaw`
      UPDATE "ContestEntry" e SET rank = r.rnk
      FROM (
        SELECT e2.id, RANK() OVER (PARTITION BY e2."contestId" ORDER BY e2."pointsX10" DESC)::int AS rnk
        FROM "ContestEntry" e2 JOIN "Contest" c ON c.id = e2."contestId"
        WHERE c."matchId" = ${match.id} AND c.status = 'LOCKED'
      ) r
      WHERE e.id = r.id AND e.rank IS DISTINCT FROM r.rnk`;

    const after = await this.snapshot(match.id);
    const prev = new Map(before.map((e) => [e.id, e]));
    const changes = new Map<string, LeaderboardChange[]>();
    for (const e of after) {
      const old = prev.get(e.id);
      if (old && old.pointsX10 === e.pointsX10 && old.rank === e.rank) continue;
      const list = changes.get(e.contestId) ?? [];
      list.push({ entryId: e.id, points: e.pointsX10 / 10, rank: e.rank });
      changes.set(e.contestId, list);
    }
    return changes;
  }

  private snapshot(matchId: string): Promise<EntrySnapshot[]> {
    return this.prisma.$queryRaw<EntrySnapshot[]>`
      SELECT e.id, e."contestId", e."pointsX10", e.rank
      FROM "ContestEntry" e JOIN "Contest" c ON c.id = e."contestId"
      WHERE c."matchId" = ${matchId} AND c.status = 'LOCKED'`;
  }

  /** Final ranks (ties share prizes) and winnings for every running contest of a completed match. */
  private async settle(matchId: string): Promise<void> {
    const contests = await this.prisma.contest.findMany({ where: { matchId, status: 'LOCKED' }, select: { id: true, prizeBreakup: true, currency: true } });
    for (const c of contests) {
      const entries = await this.prisma.contestEntry.findMany({
        where: { contestId: c.id },
        orderBy: [{ pointsX10: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, pointsX10: true },
      });
      const results = rankAndPrizes(
        entries.map((e) => e.pointsX10),
        parseBreakup(c.prizeBreakup),
      );
      const ids = entries.map((e) => e.id);
      const ranks = results.map((r) => r.rank);
      const winnings = results.map((r) => Math.round(r.prize * 100));

      await this.prisma.$transaction(async (tx) => {
        if (ids.length > 0) {
          await tx.$executeRaw`
            UPDATE "ContestEntry" e SET rank = v.rank, "winningsX100" = v.win
            FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${ranks}::int[]) AS rank, unnest(${winnings}::int[]) AS win) v
            WHERE e.id = v.id`;
        }
        // Conditional on LOCKED so a concurrent tick can never settle twice.
        const { count } = await tx.contest.updateMany({ where: { id: c.id, status: 'LOCKED' }, data: { status: 'COMPLETED', settledAt: new Date() } });
        if (count === 0) return;
        await this.audit.log(
          {
            action: 'contest.settled',
            entityType: 'Contest',
            entityId: c.id,
            metadata: { entries: ids.length, paidOut: winnings.reduce((s, w) => s + w, 0) / 100, currency: c.currency },
          },
          tx,
        );
      });

      this.gateway.emit(contestRoom(c.id), LIVE_EVENTS.leaderboard, {
        contestId: c.id,
        changes: entries.map((e, i) => ({ entryId: e.id, points: e.pointsX10 / 10, rank: ranks[i]! })),
        at: new Date().toISOString(),
      } satisfies LeaderboardDeltaEvent);
      this.gateway.emit(contestRoom(c.id), LIVE_EVENTS.contest, { contestId: c.id, status: 'COMPLETED', at: new Date().toISOString() } satisfies ContestStatusEvent);
    }
    // Winnings reach wallets after the ranks are final; each credit is idempotent per entry.
    for (const c of contests) {
      await this.wallet.creditWinnings(c.id);
      void this.events.contestSettled(c.id).catch(this.events.logError);
    }
    if (contests.length) this.logger.log(`Settled ${contests.length} contests for match ${matchId}`);
  }

  /** Admin: mark a match abandoned and cancel + refund every open or running contest. */
  async abandonMatch(matchId: string, reason: string): Promise<number> {
    await this.prisma.match.update({ where: { id: matchId }, data: { status: 'ABANDONED', statusNote: reason } });
    const n = await this.prisma.contest.count({ where: { matchId, status: { in: ['OPEN', 'LOCKED'] } } });
    await this.cancelAll(matchId, reason);
    this.gateway.emit(matchRoom(matchId), LIVE_EVENTS.match, { matchId, status: 'ABANDONED', statusNote: reason, score: null, at: new Date().toISOString() });
    return n;
  }

  /** Admin: cancel one contest (open or running) with refunds. Returns false if it had already finished. */
  async cancelContest(contestId: string, reason: string): Promise<boolean> {
    const { count } = await this.prisma.contest.updateMany({ where: { id: contestId, status: { in: ['OPEN', 'LOCKED'] } }, data: { status: 'CANCELLED', cancelReason: reason } });
    if (!count) return false;
    await this.wallet.refundContest(contestId);
    void this.events.contestCancelled(contestId).catch(this.events.logError);
    this.gateway.emit(contestRoom(contestId), LIVE_EVENTS.contest, { contestId, status: 'CANCELLED', at: new Date().toISOString() } satisfies ContestStatusEvent);
    return true;
  }

  private async cancelAll(matchId: string, reason: string): Promise<void> {
    const contests = await this.prisma.contest.findMany({ where: { matchId, status: { in: ['OPEN', 'LOCKED'] } }, select: { id: true } });
    for (const c of contests) {
      const { count } = await this.prisma.contest.updateMany({ where: { id: c.id, status: { in: ['OPEN', 'LOCKED'] } }, data: { status: 'CANCELLED', cancelReason: reason } });
      if (count) {
        await this.wallet.refundContest(c.id);
        void this.events.contestCancelled(c.id).catch(this.events.logError);
        this.gateway.emit(contestRoom(c.id), LIVE_EVENTS.contest, { contestId: c.id, status: 'CANCELLED', at: new Date().toISOString() } satisfies ContestStatusEvent);
      }
    }
  }
}
