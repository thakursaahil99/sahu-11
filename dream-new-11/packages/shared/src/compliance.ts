import { z } from 'zod';

/** Indian states and union territories (ISO 3166-2:IN codes without the "IN-" prefix). */
export const INDIAN_STATES = [
  ['AN', 'Andaman and Nicobar Islands'],
  ['AP', 'Andhra Pradesh'],
  ['AR', 'Arunachal Pradesh'],
  ['AS', 'Assam'],
  ['BR', 'Bihar'],
  ['CH', 'Chandigarh'],
  ['CT', 'Chhattisgarh'],
  ['DH', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['DL', 'Delhi'],
  ['GA', 'Goa'],
  ['GJ', 'Gujarat'],
  ['HR', 'Haryana'],
  ['HP', 'Himachal Pradesh'],
  ['JK', 'Jammu and Kashmir'],
  ['JH', 'Jharkhand'],
  ['KA', 'Karnataka'],
  ['KL', 'Kerala'],
  ['LA', 'Ladakh'],
  ['LD', 'Lakshadweep'],
  ['MP', 'Madhya Pradesh'],
  ['MH', 'Maharashtra'],
  ['MN', 'Manipur'],
  ['ML', 'Meghalaya'],
  ['MZ', 'Mizoram'],
  ['NL', 'Nagaland'],
  ['OR', 'Odisha'],
  ['PY', 'Puducherry'],
  ['PB', 'Punjab'],
  ['RJ', 'Rajasthan'],
  ['SK', 'Sikkim'],
  ['TN', 'Tamil Nadu'],
  ['TG', 'Telangana'],
  ['TR', 'Tripura'],
  ['UP', 'Uttar Pradesh'],
  ['UT', 'Uttarakhand'],
  ['WB', 'West Bengal'],
] as const;
export type StateCode = (typeof INDIAN_STATES)[number][0];
export const STATE_CODES = INDIAN_STATES.map(([c]) => c) as unknown as [StateCode, ...StateCode[]];
export const stateName = (code: string | null | undefined) => INDIAN_STATES.find(([c]) => c === code)?.[1] ?? null;
export const stateSchema = z.enum(STATE_CODES, { message: 'Choose your state' });

/**
 * A starting point only: states that have restricted paid fantasy/skill gaming at some point.
 * Laws change (and central legislation can override all of this) — set RESTRICTED_STATES
 * from current legal advice before enabling real money.
 */
export const DEFAULT_RESTRICTED_STATES: StateCode[] = ['AP', 'TG', 'AS', 'OR', 'SK', 'NL'];

// ─── TDS on online-game winnings (India, Income-tax Act s.194BA) ────────────

export interface TdsInput {
  /** This withdrawal (gross, rupees). */
  amount: number;
  /** Earlier withdrawals this financial year that weren't rejected (gross). */
  fyWithdrawals: number;
  /** Successful deposits this financial year. */
  fyDeposits: number;
  /** Real-money balance at the start of the financial year. */
  openingBalance: number;
  /** Net winnings already taxed this financial year. */
  alreadyTaxed: number;
  /** e.g. 30 */
  ratePercent: number;
}

export interface TdsResult {
  /** Net winnings this withdrawal is taxed on. */
  netWinnings: number;
  tds: number;
  /** What reaches the bank. */
  payout: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Net winnings = withdrawals (incl. this one) − deposits − opening balance − already taxed,
 * all within the financial year; TDS is the rate on any positive amount, never more than the
 * withdrawal. Have a chartered accountant confirm the rules before going live.
 */
export function computeTds(i: TdsInput): TdsResult {
  const net = Math.max(0, r2(i.fyWithdrawals + i.amount - i.fyDeposits - i.openingBalance - i.alreadyTaxed));
  const tds = Math.min(r2(i.amount), r2((net * i.ratePercent) / 100));
  return { netWinnings: net, tds, payout: r2(i.amount - tds) };
}

/** Indian financial year (1 April – 31 March, IST) containing `at`. Returns its UTC start instant. */
export function financialYearStart(at: Date = new Date()): Date {
  const ist = new Date(at.getTime() + 330 * 60_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, 3, 1) - 330 * 60_000);
}
