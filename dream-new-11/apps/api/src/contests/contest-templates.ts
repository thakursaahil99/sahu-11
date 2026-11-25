import type { ContestType, PrizeCurrency } from '@prisma/client';
import { breakupTotal, PrizeTier, validateBreakup } from '@dream11/shared';

export interface ContestTemplate {
  key: string;
  type: ContestType;
  name: string;
  totalSpots: number;
  maxEntriesPerUser: number;
  guaranteed: boolean;
  currency: PrizeCurrency;
  breakup: PrizeTier[];
}

/**
 * The default contest set auto-created for every upcoming match in demo mode.
 * All are free to enter; FREE contests pay demo credits (no cash value).
 * Paid templates are deliberately absent until real-money play is legal and enabled.
 */
export const DEMO_TEMPLATES: ContestTemplate[] = [
  {
    key: 'free-mega',
    type: 'FREE',
    name: 'Free Mega Contest',
    totalSpots: 1000,
    maxEntriesPerUser: 6,
    guaranteed: true,
    currency: 'DEMO',
    breakup: [
      { fromRank: 1, toRank: 1, amount: 2000 },
      { fromRank: 2, toRank: 2, amount: 1000 },
      { fromRank: 3, toRank: 3, amount: 500 },
      { fromRank: 4, toRank: 10, amount: 200 },
      { fromRank: 11, toRank: 50, amount: 50 },
      { fromRank: 51, toRank: 100, amount: 62 },
    ],
  },
  {
    key: 'free-wta',
    type: 'FREE',
    name: 'Winner Takes All',
    totalSpots: 10,
    maxEntriesPerUser: 1,
    guaranteed: false,
    currency: 'DEMO',
    breakup: [{ fromRank: 1, toRank: 1, amount: 500 }],
  },
  {
    key: 'free-top3',
    type: 'FREE',
    name: 'Top 3 Showdown',
    totalSpots: 50,
    maxEntriesPerUser: 3,
    guaranteed: false,
    currency: 'DEMO',
    breakup: [
      { fromRank: 1, toRank: 1, amount: 600 },
      { fromRank: 2, toRank: 2, amount: 300 },
      { fromRank: 3, toRank: 3, amount: 100 },
    ],
  },
  {
    key: 'practice-arena',
    type: 'PRACTICE',
    name: 'Practice Arena',
    totalSpots: 10_000,
    maxEntriesPerUser: 6,
    guaranteed: true,
    currency: 'NONE',
    breakup: [],
  },
  {
    key: 'practice-h2h',
    type: 'PRACTICE',
    name: 'Head-to-Head Practice',
    totalSpots: 2,
    maxEntriesPerUser: 1,
    guaranteed: false,
    currency: 'NONE',
    breakup: [],
  },
];

// Fail fast at boot if a template is inconsistent.
for (const t of DEMO_TEMPLATES) {
  const problem = validateBreakup(t.breakup, breakupTotal(t.breakup), t.totalSpots);
  if (problem) throw new Error(`Contest template "${t.key}": ${problem}`);
}
