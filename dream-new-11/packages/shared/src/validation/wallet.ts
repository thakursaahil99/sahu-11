import { z } from 'zod';
import { nameSchema } from './auth';

export const DEPOSIT_LIMITS = { min: 10, max: 100_000 } as const;
export const MIN_WITHDRAWAL = 100;

export const depositSchema = z.object({
  amount: z.coerce
    .number()
    .int('Enter a whole rupee amount')
    .min(DEPOSIT_LIMITS.min, `Minimum deposit is ₹${DEPOSIT_LIMITS.min}`)
    .max(DEPOSIT_LIMITS.max, `Maximum deposit is ₹${DEPOSIT_LIMITS.max.toLocaleString('en-IN')}`),
});

export const withdrawalSchema = z.object({
  amount: z.coerce.number().int('Enter a whole rupee amount').min(MIN_WITHDRAWAL, `Minimum withdrawal is ₹${MIN_WITHDRAWAL}`),
});

/** Indian PAN: 5 letters, 4 digits, 1 letter. */
export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN (e.g. ABCDE1234F)');

export const kycSchema = z.object({
  fullName: nameSchema,
  pan: panSchema,
});

export const txHistoryQuerySchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type DepositInput = z.input<typeof depositSchema>;
export type WithdrawalInput = z.input<typeof withdrawalSchema>;
export type KycInput = z.input<typeof kycSchema>;
