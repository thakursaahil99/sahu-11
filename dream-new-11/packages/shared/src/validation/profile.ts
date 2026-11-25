import { z } from 'zod';
import { stateSchema } from '../compliance';
import { nameSchema } from './auth';

const nonEmpty = (v: object) => Object.keys(v).length > 0;

export const updateProfileSchema = z
  .object({
    name: nameSchema.optional(),
    favouriteTeam: z.string().trim().max(40).nullable().optional(),
    city: z.string().trim().max(60).nullable().optional(),
    state: stateSchema.nullable().optional(),
  })
  .refine(nonEmpty, { message: 'Nothing to update' });

export const updateSettingsSchema = z
  .object({
    pushMatchReminders: z.boolean().optional(),
    pushContestUpdates: z.boolean().optional(),
    pushPromotions: z.boolean().optional(),
    emailUpdates: z.boolean().optional(),
    hapticsEnabled: z.boolean().optional(),
    language: z.enum(['en', 'hi']).optional(),
  })
  .refine(nonEmpty, { message: 'Nothing to update' });

export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;
