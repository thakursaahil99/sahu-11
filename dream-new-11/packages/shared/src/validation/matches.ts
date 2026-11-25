import { z } from 'zod';
import { MATCH_STATUSES } from '../types/sports';

export const sportKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{2,30}$/, 'Unknown sport');

export const listMatchesQuerySchema = z.object({
  sport: sportKeySchema.default('cricket'),
  status: z.enum(MATCH_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(64).optional(),
});

export const homeFeedQuerySchema = z.object({
  sport: sportKeySchema.default('cricket'),
});

export type ListMatchesQuery = z.input<typeof listMatchesQuerySchema>;
