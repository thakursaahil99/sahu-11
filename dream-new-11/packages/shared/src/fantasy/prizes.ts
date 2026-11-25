import type { PrizeCurrency, PrizeTier } from '../types/contests';

/** Highest paid rank, i.e. the number of winners. */
export const winnersCount = (tiers: PrizeTier[]) => tiers.reduce((max, t) => Math.max(max, t.toRank), 0);

/** Total paid out by a breakup. */
export const breakupTotal = (tiers: PrizeTier[]) => tiers.reduce((sum, t) => sum + t.amount * (t.toRank - t.fromRank + 1), 0);

export function prizeForRank(tiers: PrizeTier[], rank: number): number {
  return tiers.find((t) => rank >= t.fromRank && rank <= t.toRank)?.amount ?? 0;
}

/**
 * Checks a breakup is well formed: contiguous from rank 1, no overlaps, non-negative,
 * within the prize pool, and with no more winners than spots. Returns the first problem or null.
 */
export function validateBreakup(tiers: PrizeTier[], prizePool: number, totalSpots: number): string | null {
  if (tiers.length === 0) return prizePool > 0 ? 'Prize pool needs a breakup' : null;
  const sorted = [...tiers].sort((a, b) => a.fromRank - b.fromRank);
  let expected = 1;
  for (const t of sorted) {
    if (t.fromRank !== expected) return `Ranks must be contiguous from 1 (expected rank ${expected})`;
    if (t.toRank < t.fromRank) return 'Each tier must end at or after its first rank';
    if (t.amount < 0) return 'Prizes cannot be negative';
    expected = t.toRank + 1;
  }
  if (winnersCount(tiers) > totalSpots) return 'More winners than spots';
  if (breakupTotal(tiers) > prizePool + 1e-9) return 'Breakup exceeds the prize pool';
  return null;
}

/**
 * Splits prizes for tied ranks: teams tied over ranks r..r+k-1 share the sum of those
 * ranks' prizes equally. `points` must be sorted descending. Returns rank and prize per index.
 */
export function rankAndPrizes(points: number[], tiers: PrizeTier[]): { rank: number; prize: number }[] {
  const out: { rank: number; prize: number }[] = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && points[j + 1] === points[i]) j++;
    const rank = i + 1;
    let pot = 0;
    for (let r = rank; r <= j + 1; r++) pot += prizeForRank(tiers, r);
    const share = Math.floor((pot / (j - i + 1)) * 100) / 100;
    for (let k = i; k <= j; k++) out.push({ rank, prize: share });
    i = j + 1;
  }
  return out;
}

/** "10,000 DC", "₹49", "Glory". */
export function formatAmount(amount: number, currency: PrizeCurrency): string {
  if (currency === 'NONE' || amount === 0) return currency === 'NONE' ? 'Glory' : '0';
  const n = amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return currency === 'INR' ? `₹${n}` : `${n} DC`;
}
