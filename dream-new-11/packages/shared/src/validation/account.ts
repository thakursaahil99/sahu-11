import { z } from 'zod';
import { TICKET_CATEGORIES } from '../types/account';

export const notificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(60).optional(),
});

export const markReadSchema = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(100) })]);
export type MarkReadInput = z.infer<typeof markReadSchema>;

export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(400),
  kind: z.enum(['EXPO', 'FCM']),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

export const myContestsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(60).optional(),
});

// ─── Support ────────────────────────────────────────────────────────────────

export const createTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES, { message: 'Choose a topic' }),
  subject: z.string().trim().min(5, 'Add a short subject (at least 5 characters)').max(120, 'Keep the subject under 120 characters'),
  message: z.string().trim().min(20, 'Describe the problem in at least 20 characters').max(2000, 'Keep it under 2,000 characters'),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const ticketReplySchema = z.object({
  message: z.string().trim().min(1, 'Write a message').max(2000, 'Keep it under 2,000 characters'),
});
export type TicketReplyInput = z.infer<typeof ticketReplySchema>;

/** Most open tickets a user can have at once. */
export const MAX_OPEN_TICKETS = 5;

// ─── Responsible play ───────────────────────────────────────────────────────

/** Raising or removing a deposit limit takes effect after this many hours. */
export const LIMIT_COOLING_OFF_HOURS = 24;
export const BREAK_OPTIONS_DAYS = [1, 7, 30, 90, 180, 365] as const;
export const MAX_DEPOSIT_LIMIT = 1_000_000;

const limit = z
  .number({ message: 'Enter an amount' })
  .int('Use whole rupees')
  .min(100, 'Minimum limit is ₹100')
  .max(MAX_DEPOSIT_LIMIT, 'Maximum limit is ₹10,00,000')
  .nullable();

export const depositLimitsSchema = z
  .object({ daily: limit, weekly: limit, monthly: limit })
  .superRefine((v, ctx) => {
    if (v.daily !== null && v.weekly !== null && v.daily > v.weekly) ctx.addIssue({ code: 'custom', path: ['weekly'], message: 'Weekly limit can’t be lower than daily' });
    if (v.weekly !== null && v.monthly !== null && v.weekly > v.monthly) ctx.addIssue({ code: 'custom', path: ['monthly'], message: 'Monthly limit can’t be lower than weekly' });
    if (v.daily !== null && v.monthly !== null && v.daily > v.monthly) ctx.addIssue({ code: 'custom', path: ['monthly'], message: 'Monthly limit can’t be lower than daily' });
  });
export type DepositLimitsInput = z.infer<typeof depositLimitsSchema>;

export const takeBreakSchema = z.object({
  days: z.number().refine((d) => (BREAK_OPTIONS_DAYS as readonly number[]).includes(d), 'Choose a break length'),
});
export type TakeBreakInput = z.infer<typeof takeBreakSchema>;

export const deleteAccountSchema = z.object({
  confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
