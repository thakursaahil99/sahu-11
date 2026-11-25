import { z } from 'zod';

const id = z.string().min(1).max(64);

const teamBody = {
  playerIds: z.array(id).min(1, 'Pick your players').max(30),
  captainId: id,
  viceCaptainId: id,
};

export const createTeamSchema = z.object({ matchId: id, ...teamBody });
export const updateTeamSchema = z.object(teamBody);

export const listTeamsQuerySchema = z.object({
  matchId: id.optional(),
});

export type CreateTeamInput = z.input<typeof createTeamSchema>;
export type UpdateTeamInput = z.input<typeof updateTeamSchema>;
