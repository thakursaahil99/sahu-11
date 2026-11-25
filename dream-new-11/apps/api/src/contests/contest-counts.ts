import type { PrismaService } from '../prisma/prisma.service';

/**
 * Joinable public contests per match — the number shown on match cards.
 * Paid contests only count when paid play is enabled.
 */
export async function openContestCounts(prisma: PrismaService, matchIds: string[], paidEnabled: boolean): Promise<Map<string, number>> {
  if (matchIds.length === 0) return new Map();
  const rows = await prisma.contest.groupBy({
    by: ['matchId'],
    where: {
      matchId: { in: matchIds },
      status: 'OPEN',
      type: { in: ['PRACTICE', 'FREE', 'PUBLIC'] },
      ...(paidEnabled ? {} : { entryFeeX100: 0 }),
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.matchId, r._count._all]));
}
