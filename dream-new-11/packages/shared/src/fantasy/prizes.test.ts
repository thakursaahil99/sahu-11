import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrizeTier } from '../types/contests';
import { breakupTotal, formatAmount, prizeForRank, rankAndPrizes, validateBreakup, winnersCount } from './prizes';

const mega: PrizeTier[] = [
  { fromRank: 1, toRank: 1, amount: 2000 },
  { fromRank: 2, toRank: 2, amount: 1000 },
  { fromRank: 3, toRank: 3, amount: 500 },
  { fromRank: 4, toRank: 10, amount: 200 },
  { fromRank: 11, toRank: 50, amount: 50 },
  { fromRank: 51, toRank: 100, amount: 62 },
];

test('mega breakup totals the pool and pays 100 winners', () => {
  assert.equal(breakupTotal(mega), 10_000);
  assert.equal(winnersCount(mega), 100);
  assert.equal(validateBreakup(mega, 10_000, 1000), null);
  assert.equal(prizeForRank(mega, 7), 200);
  assert.equal(prizeForRank(mega, 101), 0);
});

test('invalid breakups are rejected', () => {
  assert.match(validateBreakup([{ fromRank: 2, toRank: 2, amount: 1 }], 10, 10)!, /contiguous/);
  assert.match(validateBreakup(mega, 9_999, 1000)!, /exceeds/);
  assert.match(validateBreakup(mega, 10_000, 50)!, /More winners/);
  assert.match(validateBreakup([], 100, 10)!, /needs a breakup/);
});

test('tied teams share the prizes of the ranks they cover', () => {
  const tiers: PrizeTier[] = [
    { fromRank: 1, toRank: 1, amount: 100 },
    { fromRank: 2, toRank: 2, amount: 50 },
    { fromRank: 3, toRank: 3, amount: 30 },
  ];
  // Two teams tied for 2nd share (50 + 30) / 2 = 40 each.
  assert.deepEqual(rankAndPrizes([90, 80, 80, 10], tiers), [
    { rank: 1, prize: 100 },
    { rank: 2, prize: 40 },
    { rank: 2, prize: 40 },
    { rank: 4, prize: 0 },
  ]);
});

test('amount formatting', () => {
  assert.equal(formatAmount(10_000, 'DEMO'), '10,000 DC');
  assert.equal(formatAmount(49, 'INR'), '₹49');
  assert.equal(formatAmount(0, 'NONE'), 'Glory');
});
