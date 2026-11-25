import type { FantasyRules } from '../fantasy/team-rules';
import type { MatchDetailDto, MatchPlayerDto, MatchSummaryDto, PlayerRole } from './sports';

export type FantasyRulesDto = FantasyRules;

export interface UserTeamDto {
  id: string;
  matchId: string;
  teamNumber: number;
  /** Display name, e.g. "T2". */
  name: string;
  captainId: string;
  viceCaptainId: string;
  credits: number;
  /** Players with the credits they had when the team was saved. */
  players: MatchPlayerDto[];
  roleCounts: Record<PlayerRole, number>;
  teamCounts: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerSelectionDto {
  /** Percent of teams for this match that picked the player, 0–100. */
  selectedBy: number;
  captainBy: number;
  viceCaptainBy: number;
}

/** Everything the team builder needs in one request. */
export interface TeamBuilderDto {
  match: MatchDetailDto;
  rules: FantasyRulesDto;
  selection: Record<string, PlayerSelectionDto>;
  myTeams: UserTeamDto[];
  /** False once the deadline passes; the builder becomes read-only. */
  editable: boolean;
}

export interface TeamWithMatchDto extends UserTeamDto {
  match: MatchSummaryDto;
  editable: boolean;
}

export interface MyTeamsGroupDto {
  match: MatchSummaryDto;
  teams: UserTeamDto[];
}
