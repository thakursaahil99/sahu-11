import type { Player, UserTeam, UserTeamPlayer } from '@prisma/client';
import type { MatchPlayerDto, PlayerRole, UserTeamDto } from '@dream11/shared';
import { toMatchPlayer } from '../sports/match.mapper';

export const teamInclude = { players: { include: { player: true } } } as const;

export type TeamWithPlayers = UserTeam & { players: (UserTeamPlayer & { player: Player })[] };

const ROLE_ORDER: Record<PlayerRole, number> = { WK: 0, BAT: 1, AR: 2, BOWL: 3 };

/**
 * @param isPlaying current lineup status per player for the match, so saved teams can flag
 *   players who were left out after lineups were announced.
 */
export function toUserTeamDto(team: TeamWithPlayers, isPlaying: Map<string, boolean | null>): UserTeamDto {
  const players: MatchPlayerDto[] = team.players
    .map((tp) =>
      toMatchPlayer({
        matchId: team.matchId,
        playerId: tp.playerId,
        teamId: tp.sideTeamId,
        role: tp.role,
        creditsX10: tp.creditsX10,
        isPlaying: isPlaying.get(tp.playerId) ?? null,
        player: tp.player,
      }),
    )
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.credits - a.credits);

  const roleCounts = { WK: 0, BAT: 0, AR: 0, BOWL: 0 } as Record<PlayerRole, number>;
  const teamCounts: Record<string, number> = {};
  for (const p of players) {
    roleCounts[p.role] += 1;
    teamCounts[p.teamId] = (teamCounts[p.teamId] ?? 0) + 1;
  }

  return {
    id: team.id,
    matchId: team.matchId,
    teamNumber: team.teamNumber,
    name: `T${team.teamNumber}`,
    captainId: team.captainId,
    viceCaptainId: team.viceCaptainId,
    credits: team.creditsX10 / 10,
    players,
    roleCounts,
    teamCounts,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}
