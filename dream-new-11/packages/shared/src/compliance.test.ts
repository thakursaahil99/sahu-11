import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTds, financialYearStart, stateSchema } from './compliance';

const base = { fyWithdrawals: 0, fyDeposits: 0, openingBalance: 0, alreadyTaxed: 0, ratePercent: 30 };

test('tds: withdrawing only your own deposits is not taxed', () => {
  assert.deepEqual(computeTds({ ...base, amount: 500, fyDeposits: 1000 }), { netWinnings: 0, tds: 0, payout: 500 });
});

test('tds: 30% of net winnings', () => {
  // Deposited 1,000, won; withdrawing 3,000 → net winnings 2,000 → TDS 600.
  assert.deepEqual(computeTds({ ...base, amount: 3000, fyDeposits: 1000 }), { netWinnings: 2000, tds: 600, payout: 2400 });
});

test('tds: earlier taxed winnings are not taxed again', () => {
  // Second withdrawal of 1,000 after the one above (net 2,000 already taxed).
  const r = computeTds({ ...base, amount: 1000, fyWithdrawals: 3000, fyDeposits: 1000, alreadyTaxed: 2000 });
  assert.deepEqual(r, { netWinnings: 1000, tds: 300, payout: 700 });
});

test('tds: opening balance counts like a deposit', () => {
  assert.equal(computeTds({ ...base, amount: 800, openingBalance: 1000 }).tds, 0);
});

test('tds: never more than the withdrawal, and rounds to paise', () => {
  // Net winnings 10,100 → 30% is 3,030, capped at the 100 being withdrawn.
  const r = computeTds({ ...base, amount: 100, fyWithdrawals: 10_000, ratePercent: 30 });
  assert.deepEqual([r.tds, r.payout], [100, 0]);
  assert.equal(computeTds({ ...base, amount: 333.33 }).tds, 100);
});

test('financial year starts 1 April IST', () => {
  assert.equal(financialYearStart(new Date('2026-10-22T10:00:00Z')).toISOString(), '2026-03-31T18:30:00.000Z');
  assert.equal(financialYearStart(new Date('2027-02-01T10:00:00Z')).toISOString(), '2026-03-31T18:30:00.000Z');
  // 31 March 23:59 IST still belongs to the previous year.
  assert.equal(financialYearStart(new Date('2026-03-31T18:29:00Z')).toISOString(), '2025-03-31T18:30:00.000Z');
});

test('state codes are validated', () => {
  assert.equal(stateSchema.safeParse('MH').success, true);
  assert.equal(stateSchema.safeParse('XX').success, false);
});
