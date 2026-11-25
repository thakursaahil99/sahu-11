import type { Contest } from '@prisma/client';
import { ContestSummaryDto, PrizeTier, winnersCount } from '@dream11/shared';

export interface StoredTier {
  fromRank: number;
  toRank: number;
  amountX100: number;
}

export function parseBreakup(json: unknown): PrizeTier[] {
  if (!Array.isArray(json)) return [];
  return (json as StoredTier[]).map((t) => ({ fromRank: t.fromRank, toRank: t.toRank, amount: t.amountX100 / 100 }));
}

export const toStoredBreakup = (tiers: PrizeTier[]): StoredTier[] =>
  tiers.map((t) => ({ fromRank: t.fromRank, toRank: t.toRank, amountX100: Math.round(t.amount * 100) }));

export function toContestSummary(c: Contest, userId: string, myEntries: number): ContestSummaryDto {
  const tiers = parseBreakup(c.prizeBreakup);
  const createdByMe = c.createdById === userId;
  return {
    id: c.id,
    matchId: c.matchId,
    type: c.type,
    name: c.name,
    status: c.status,
    entryFee: c.entryFeeX100 / 100,
    isPaid: c.entryFeeX100 > 0,
    prizePool: c.prizePoolX100 / 100,
    currency: c.currency,
    totalSpots: c.totalSpots,
    filledSpots: c.filledSpots,
    spotsLeft: Math.max(0, c.totalSpots - c.filledSpots),
    maxEntriesPerUser: c.maxEntriesPerUser,
    guaranteed: c.guaranteed,
    firstPrize: tiers.find((t) => t.fromRank === 1)?.amount ?? 0,
    winners: winnersCount(tiers),
    myEntries,
    // Invite codes are only revealed to people already inside the contest.
    inviteCode: c.type === 'PRIVATE' && (createdByMe || myEntries > 0) ? c.inviteCode : null,
    createdByMe,
    cancelReason: c.cancelReason,
  };
}
