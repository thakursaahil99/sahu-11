import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ContestStatus, ContestType, MatchStatus, Prisma } from '@prisma/client';
import {
  ContestDetailDto,
  ContestSummaryDto,
  createPrivateContestSchema,
  formatAmount,
  InviteLookupDto,
  joinContestSchema,
  JoinResultDto,
  MatchContestsDto,
  MyMatchDto,
  switchTeamSchema,
} from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { Env, InjectEnv } from '../config/config.module';
import { paidContestsEnabled } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationEvents } from '../notifications/notification-events';
import { ResponsiblePlayService } from '../responsible-play/responsible-play.service';
import { matchSummaryInclude, toMatchSummary } from '../sports/match.mapper';
import { openContestCounts } from './contest-counts';
import { parseBreakup, toContestSummary } from './contest.mapper';

type JoinInput = z.output<typeof joinContestSchema>;
type SwitchInput = z.output<typeof switchTeamSchema>;
type CreatePrivateInput = z.output<typeof createPrivateContestSchema>;

const LEADERBOARD_LIMIT = 100;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PUBLIC_TYPES: ContestType[] = ['PRACTICE', 'FREE', 'PUBLIC'];

/** The contest row as read under `FOR UPDATE`, joined with its match's deadline. */
interface LockedContest {
  id: string;
  name: string;
  matchId: string;
  type: ContestType;
  status: ContestStatus;
  entryFeeX100: number;
  totalSpots: number;
  filledSpots: number;
  maxEntriesPerUser: number;
  inviteCode: string | null;
  createdById: string | null;
  startTime: Date;
  matchStatus: MatchStatus;
}

const isBeforeDeadline = (matchStatus: MatchStatus, startTime: Date) => matchStatus === 'UPCOMING' && startTime.getTime() > Date.now();

@Injectable()
export class ContestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
    private readonly play: ResponsiblePlayService,
    private readonly events: NotificationEvents,
    @InjectEnv() private readonly env: Env,
  ) {}

  private get paidEnabled(): boolean {
    return paidContestsEnabled(this.env);
  }

  async listForMatch(userId: string, matchId: string): Promise<MatchContestsDto> {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, sport: { enabled: true } }, select: { id: true } });
    if (!match) throw new NotFoundException('Match not found');

    const [publicRows, privateRows] = await Promise.all([
      this.prisma.contest.findMany({
        where: {
          matchId,
          type: { in: PUBLIC_TYPES },
          ...(this.paidEnabled ? {} : { entryFeeX100: 0 }),
          OR: [{ status: { not: 'CANCELLED' } }, { entries: { some: { userId } } }],
        },
      }),
      this.prisma.contest.findMany({
        where: { matchId, type: 'PRIVATE', OR: [{ createdById: userId }, { entries: { some: { userId } } }] },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const mine = await this.myEntryCounts(userId, [...publicRows, ...privateRows].map((c) => c.id));
    const order = (c: (typeof publicRows)[number]) => [c.status === 'OPEN' ? 0 : 1, c.guaranteed ? 0 : 1, -c.prizePoolX100, -c.totalSpots];
    publicRows.sort((a, b) => {
      const x = order(a);
      const y = order(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
      return 0;
    });

    return {
      contests: publicRows.map((c) => toContestSummary(c, userId, mine.get(c.id) ?? 0)),
      myPrivate: privateRows.map((c) => toContestSummary(c, userId, mine.get(c.id) ?? 0)),
      paidContestsEnabled: this.paidEnabled,
    };
  }

  async detail(userId: string, contestId: string): Promise<ContestDetailDto> {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      include: { match: { include: matchSummaryInclude } },
    });
    if (!contest) throw new NotFoundException('Contest not found');

    const myEntries = await this.prisma.contestEntry.findMany({
      where: { contestId, userId },
      include: { team: { select: { teamNumber: true } } },
      orderBy: { team: { teamNumber: 'asc' } },
    });
    const visible =
      myEntries.length > 0 ||
      contest.createdById === userId ||
      (contest.type !== 'PRIVATE' && (contest.entryFeeX100 === 0 || this.paidEnabled));
    // Private contests are reachable only through their invite code until you join.
    if (!visible) throw new NotFoundException('Contest not found');

    const started = contest.match.status !== 'UPCOMING';
    const rows = await this.prisma.contestEntry.findMany({
      where: { contestId },
      include: { user: { select: { name: true, avatarUrl: true } }, team: { select: { teamNumber: true } } },
      orderBy: started ? [{ pointsX10: 'desc' }, { createdAt: 'asc' }] : [{ createdAt: 'asc' }],
      take: LEADERBOARD_LIMIT,
    });

    const summary = toContestSummary(contest, userId, myEntries.length);
    return {
      ...summary,
      match: toMatchSummary(contest.match, (await openContestCounts(this.prisma, [contest.matchId], this.paidEnabled)).get(contest.matchId) ?? 0),
      prizeBreakup: parseBreakup(contest.prizeBreakup),
      rules: this.rules(summary, contest.match.startTime),
      myTeams: myEntries.map((e) => ({
        entryId: e.id,
        teamId: e.teamId,
        teamName: `T${e.team.teamNumber}`,
        points: e.pointsX10 / 10,
        rank: e.rank,
        winnings: e.winningsX100 / 100,
      })),
      leaderboard: rows.map((e) => ({
        entryId: e.id,
        userName: e.user.name,
        avatarUrl: e.user.avatarUrl,
        teamName: `T${e.team.teamNumber}`,
        points: e.pointsX10 / 10,
        rank: e.rank,
        isMe: e.userId === userId,
      })),
      joinable: contest.status === 'OPEN' && isBeforeDeadline(contest.match.status, contest.match.startTime),
    };
  }

  /**
   * Joins with one or more teams. The contest row is locked (`SELECT … FOR UPDATE`) for the whole
   * transaction, so concurrent joins are serialised: spots can never overfill and per-user entry
   * limits hold. A CHECK constraint in Postgres backs this up.
   */
  async join(userId: string, contestId: string, input: JoinInput, meta: RequestMeta): Promise<JoinResultDto> {
    const teamIds = [...new Set(input.teamIds)];
    await this.play.assertCanPlay(userId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const [c] = await tx.$queryRaw<LockedContest[]>`
        SELECT c.id, c."matchId", c.name, c.type, c.status, c."entryFeeX100", c."totalSpots", c."filledSpots",
               c."maxEntriesPerUser", c."inviteCode", c."createdById", m."startTime", m.status AS "matchStatus"
        FROM "Contest" c JOIN "Match" m ON m.id = c."matchId"
        WHERE c.id = ${contestId}
        FOR UPDATE OF c`;
      if (!c) throw new NotFoundException('Contest not found');

      const already = await tx.contestEntry.findMany({ where: { contestId, userId }, select: { teamId: true } });
      this.assertJoinable(c, userId, already.length, input.inviteCode);

      const teams = await tx.userTeam.findMany({ where: { id: { in: teamIds }, userId, matchId: c.matchId }, select: { id: true } });
      if (teams.length !== teamIds.length) throw new BadRequestException('Pick teams you created for this match');

      const dupes = teamIds.filter((id) => already.some((e) => e.teamId === id));
      if (dupes.length) throw new ConflictException('One of these teams has already joined this contest');

      if (already.length + teamIds.length > c.maxEntriesPerUser) {
        const left = c.maxEntriesPerUser - already.length;
        throw new ConflictException(
          left === 0
            ? `You’ve already joined with the maximum ${c.maxEntriesPerUser} ${c.maxEntriesPerUser === 1 ? 'team' : 'teams'}`
            : `You can join with ${left} more ${left === 1 ? 'team' : 'teams'}`,
        );
      }
      const spotsLeft = c.totalSpots - c.filledSpots;
      if (teamIds.length > spotsLeft) {
        throw new ConflictException(spotsLeft === 0 ? 'This contest is full' : `Only ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`);
      }

      // Paid entry: debit the wallet in this same transaction, so a failed charge means no entry.
      if (c.entryFeeX100 > 0) {
        await this.play.assertRealMoneyRegion(userId, meta);
        await this.wallet.chargeEntry(tx, userId, { id: c.id, name: c.name, entryFeeX100: c.entryFeeX100 }, teamIds);
      }
      await tx.contestEntry.createMany({ data: teamIds.map((teamId) => ({ contestId, userId, teamId })) });
      const contest = await tx.contest.update({ where: { id: contestId }, data: { filledSpots: { increment: teamIds.length } } });
      await this.audit.log({ action: 'contest.join', actorId: userId, entityType: 'Contest', entityId: contestId, metadata: { teams: teamIds.length }, meta }, tx);
      return contest;
    });

    void this.events.contestJoined(userId, contestId).catch(this.events.logError);
    return { contest: toContestSummary(updated, userId, await this.prisma.contestEntry.count({ where: { contestId, userId } })), joinedTeamIds: teamIds };
  }

  /** Swap which of your teams an entry uses, until the deadline. */
  async switchTeam(userId: string, contestId: string, entryId: string, input: SwitchInput): Promise<ContestDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.contestEntry.findFirst({
        where: { id: entryId, contestId, userId },
        include: { contest: { include: { match: { select: { status: true, startTime: true } } } } },
      });
      if (!entry) throw new NotFoundException('Entry not found');
      if (entry.contest.status !== 'OPEN' || !isBeforeDeadline(entry.contest.match.status, entry.contest.match.startTime)) {
        throw new ForbiddenException('The deadline has passed. Teams are locked.');
      }
      if (entry.teamId === input.teamId) return;
      const team = await tx.userTeam.findFirst({ where: { id: input.teamId, userId, matchId: entry.contest.matchId }, select: { id: true } });
      if (!team) throw new BadRequestException('Pick a team you created for this match');
      if (await tx.contestEntry.findFirst({ where: { contestId, teamId: input.teamId }, select: { id: true } })) {
        throw new ConflictException('That team has already joined this contest');
      }
      await tx.contestEntry.update({ where: { id: entryId }, data: { teamId: input.teamId } });
    });
    return this.detail(userId, contestId);
  }

  /** Creates a private contest and joins the creator with their chosen team, atomically. */
  async createPrivate(userId: string, input: CreatePrivateInput, meta: RequestMeta): Promise<ContestDetailDto> {
    await this.play.assertCanPlay(userId);
    const match = await this.prisma.match.findFirst({
      where: { id: input.matchId, sport: { enabled: true } },
      select: { id: true, status: true, startTime: true },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (!isBeforeDeadline(match.status, match.startTime)) throw new ForbiddenException('This match has already started');
    const team = await this.prisma.userTeam.findFirst({ where: { id: input.teamId, userId, matchId: match.id }, select: { id: true } });
    if (!team) throw new BadRequestException('Create a team for this match first');

    const contestId = await this.withUniqueInviteCode(async (inviteCode) =>
      this.prisma.$transaction(async (tx) => {
        const contest = await tx.contest.create({
          data: {
            matchId: match.id,
            type: 'PRIVATE',
            name: input.name,
            totalSpots: input.totalSpots,
            maxEntriesPerUser: input.maxEntriesPerUser,
            currency: 'NONE',
            inviteCode,
            createdById: userId,
            filledSpots: 1,
            entries: { create: { userId, teamId: team.id } },
          },
          select: { id: true },
        });
        await this.audit.log({ action: 'contest.create_private', actorId: userId, entityType: 'Contest', entityId: contest.id, meta }, tx);
        return contest.id;
      }),
    );
    return this.detail(userId, contestId);
  }

  async lookupInvite(userId: string, code: string): Promise<InviteLookupDto> {
    const contest = await this.prisma.contest.findUnique({
      where: { inviteCode: code },
      include: { match: { include: matchSummaryInclude }, createdBy: { select: { name: true } } },
    });
    if (!contest || contest.type !== 'PRIVATE') throw new NotFoundException('No contest found for this code');
    const mine = await this.prisma.contestEntry.count({ where: { contestId: contest.id, userId } });
    return {
      // Holding the code is proof of invitation, so the caller may see it.
      contest: { ...toContestSummary(contest, userId, mine), inviteCode: contest.inviteCode },
      match: toMatchSummary(contest.match, (await openContestCounts(this.prisma, [contest.matchId], this.paidEnabled)).get(contest.matchId) ?? 0),
      createdByName: contest.createdBy?.name ?? 'A player',
    };
  }

  /** Matches the user has joined contests in, for the My Matches tab. */
  async myMatches(userId: string, status: MatchStatus): Promise<MyMatchDto[]> {
    const statuses: MatchStatus[] = status === 'COMPLETED' ? ['COMPLETED', 'ABANDONED'] : [status];
    const matches = await this.prisma.match.findMany({
      where: { status: { in: statuses }, contests: { some: { entries: { some: { userId } } } } },
      include: matchSummaryInclude,
      orderBy: { startTime: status === 'UPCOMING' ? 'asc' : 'desc' },
      take: 50,
    });
    if (matches.length === 0) return [];
    const ids = matches.map((m) => m.id);
    const [contestRows, teamRows] = await Promise.all([
      this.prisma.$queryRaw<{ matchId: string; n: number }[]>(Prisma.sql`
        SELECT c."matchId", count(DISTINCT c.id)::int AS n
        FROM "ContestEntry" e JOIN "Contest" c ON c.id = e."contestId"
        WHERE e."userId" = ${userId} AND c."matchId" IN (${Prisma.join(ids)})
        GROUP BY c."matchId"`),
      this.prisma.userTeam.groupBy({ by: ['matchId'], where: { userId, matchId: { in: ids } }, _count: { _all: true } }),
    ]);
    const contests = new Map(contestRows.map((r) => [r.matchId, r.n]));
    const teams = new Map(teamRows.map((r) => [r.matchId, r._count._all]));
    const open = await openContestCounts(this.prisma, ids, this.paidEnabled);
    return matches.map((m) => ({ match: toMatchSummary(m, open.get(m.id) ?? 0), contestsJoined: contests.get(m.id) ?? 0, teamsCreated: teams.get(m.id) ?? 0 }));
  }

  private assertJoinable(c: LockedContest, userId: string, myEntries: number, inviteCode: string | undefined): void {
    if (c.status !== 'OPEN' || !isBeforeDeadline(c.matchStatus, c.startTime)) {
      throw new ForbiddenException(c.status === 'CANCELLED' ? 'This contest was cancelled' : 'This contest is closed — the match has started');
    }
    if (c.type === 'PRIVATE' && c.createdById !== userId && myEntries === 0 && inviteCode !== c.inviteCode) {
      throw new ForbiddenException('You need the invite code to join this private contest');
    }
    if (c.entryFeeX100 > 0 && !this.paidEnabled) throw new ForbiddenException('Paid contests are not available');
  }

  private async myEntryCounts(userId: string, contestIds: string[]): Promise<Map<string, number>> {
    if (contestIds.length === 0) return new Map();
    const rows = await this.prisma.contestEntry.groupBy({ by: ['contestId'], where: { userId, contestId: { in: contestIds } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.contestId, r._count._all]));
  }

  private rules(c: ContestSummaryDto, startTime: Date): string[] {
    const time = startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const rules = [
      `Join with up to ${c.maxEntriesPerUser} ${c.maxEntriesPerUser === 1 ? 'team' : 'teams'}.`,
      `Entries lock when the match starts (${time} IST). You can switch teams until then.`,
      c.type === 'PRIVATE'
        ? 'Runs if at least 2 teams join; otherwise it is cancelled.'
        : c.guaranteed
          ? 'Guaranteed: runs even if it doesn’t fill up.'
          : 'Cancelled if it doesn’t fill up before the deadline.',
      'Teams tied on points share the prizes for the ranks they cover equally.',
    ];
    if (c.currency === 'DEMO') rules.push(`Prizes are demo credits (${formatAmount(c.prizePool, 'DEMO')} pool) with no cash value.`);
    if (c.currency === 'NONE') rules.push('No prizes — play for bragging rights and practice.');
    return rules;
  }

  private async withUniqueInviteCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');
      try {
        return await fn(code);
      } catch (err) {
        const clash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target).includes('inviteCode');
        if (!clash) throw err;
      }
    }
    throw new ServiceUnavailableException('Could not create the contest, please try again');
  }
}
