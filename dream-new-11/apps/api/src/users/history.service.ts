import { Injectable } from '@nestjs/common';
import type { MyContestDto, ProfileStatsDto } from '@dream11/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Profile history: every contest entry, and summary stats with a points trend. */
@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async contests(userId: string, limit: number, cursor?: string): Promise<{ items: MyContestDto[]; nextCursor: string | null }> {
    const rows = await this.prisma.contestEntry.findMany({
      where: { userId },
      orderBy: [{ contest: { match: { startTime: 'desc' } } }, { createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        pointsX10: true,
        rank: true,
        winningsX100: true,
        team: { select: { teamNumber: true } },
        contest: {
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
            currency: true,
            totalSpots: true,
            match: { select: { id: true, status: true, startTime: true, homeTeam: { select: { shortName: true } }, awayTeam: { select: { shortName: true } } } },
          },
        },
      },
    });
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map(
      (e): MyContestDto => ({
        entryId: e.id,
        contestId: e.contest.id,
        contestName: e.contest.name,
        contestType: e.contest.type,
        contestStatus: e.contest.status,
        currency: e.contest.currency,
        matchId: e.contest.match.id,
        matchTitle: `${e.contest.match.homeTeam.shortName} vs ${e.contest.match.awayTeam.shortName}`,
        matchStatus: e.contest.match.status,
        startTime: e.contest.match.startTime.toISOString(),
        teamName: `T${e.team.teamNumber}`,
        points: e.pointsX10 / 10,
        rank: e.rank,
        totalSpots: e.contest.totalSpots,
        winnings: e.winningsX100 / 100,
      }),
    );
    return { items, nextCursor: more ? items[items.length - 1]!.entryId : null };
  }

  async stats(userId: string): Promise<ProfileStatsDto> {
    const [[counts], winnings, recent] = await Promise.all([
      this.prisma.$queryRaw<{ contests: bigint; teams: bigint; matches: bigint; wins: bigint; best: number | null }[]>`
        SELECT
          (SELECT COUNT(DISTINCT "contestId") FROM "ContestEntry" WHERE "userId" = ${userId}) AS contests,
          (SELECT COUNT(*) FROM "UserTeam" WHERE "userId" = ${userId}) AS teams,
          (SELECT COUNT(DISTINCT "matchId") FROM "UserTeam" WHERE "userId" = ${userId}) AS matches,
          (SELECT COUNT(*) FROM "ContestEntry" WHERE "userId" = ${userId} AND "winningsX100" > 0) AS wins,
          (SELECT MIN(e.rank) FROM "ContestEntry" e JOIN "Contest" c ON c.id = e."contestId"
             WHERE e."userId" = ${userId} AND c.status = 'COMPLETED') AS best`,
      this.prisma.$queryRaw<{ currency: string; total: bigint }[]>`
        SELECT c.currency, SUM(e."winningsX100") AS total
        FROM "ContestEntry" e JOIN "Contest" c ON c.id = e."contestId"
        WHERE e."userId" = ${userId} AND e."winningsX100" > 0
        GROUP BY c.currency`,
      this.prisma.$queryRaw<{ matchId: string; home: string; away: string; startTime: Date; points: number }[]>`
        SELECT m.id AS "matchId", h."shortName" AS home, a."shortName" AS away, m."startTime", MAX(t."pointsX10") AS points
        FROM "UserTeam" t
        JOIN "Match" m ON m.id = t."matchId"
        JOIN "Team" h ON h.id = m."homeTeamId"
        JOIN "Team" a ON a.id = m."awayTeamId"
        WHERE t."userId" = ${userId} AND m.status = 'COMPLETED'
        GROUP BY m.id, h."shortName", a."shortName", m."startTime"
        ORDER BY m."startTime" DESC
        LIMIT 10`,
    ]);
    const won = new Map(winnings.map((w) => [w.currency, Number(w.total) / 100]));
    return {
      contests: Number(counts?.contests ?? 0),
      teams: Number(counts?.teams ?? 0),
      matches: Number(counts?.matches ?? 0),
      wins: Number(counts?.wins ?? 0),
      bestRank: counts?.best ?? null,
      winnings: { DEMO: won.get('DEMO') ?? 0, INR: won.get('INR') ?? 0 },
      recent: recent
        .reverse()
        .map((r) => ({ matchId: r.matchId, label: `${r.home} v ${r.away}`, startTime: r.startTime.toISOString(), points: Number(r.points) / 10 })),
    };
  }
}
