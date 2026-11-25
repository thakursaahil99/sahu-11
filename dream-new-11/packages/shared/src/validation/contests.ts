import { z } from 'zod';
import { MATCH_STATUSES } from '../types/sports';

const id = z.string().min(1).max(64);

/** 8 characters from an unambiguous alphabet; input is upper-cased and trimmed. */
export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{8}$/, 'Enter the 8-character invite code');

export const joinContestSchema = z.object({
  teamIds: z.array(id).min(1, 'Pick at least one team').max(20),
  inviteCode: inviteCodeSchema.optional(),
});

export const switchTeamSchema = z.object({
  teamId: id,
});

export const createPrivateContestSchema = z.object({
  matchId: id,
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(40, 'Name must be at most 40 characters'),
  totalSpots: z.coerce.number().int().min(2, 'At least 2 spots').max(100, 'At most 100 spots'),
  maxEntriesPerUser: z.coerce.number().int().min(1).max(6),
  /** The creator joins with this team straight away. */
  teamId: id,
});

export const myMatchesQuerySchema = z.object({
  status: z.enum(MATCH_STATUSES).default('UPCOMING'),
});

export type JoinContestInput = z.input<typeof joinContestSchema>;
export type SwitchTeamInput = z.input<typeof switchTeamSchema>;
export type CreatePrivateContestInput = z.input<typeof createPrivateContestSchema>;
