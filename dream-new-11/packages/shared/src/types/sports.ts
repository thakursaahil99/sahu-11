export const MATCH_STATUSES = ['UPCOMING', 'LIVE', 'COMPLETED', 'ABANDONED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const PLAYER_ROLES = ['WK', 'BAT', 'AR', 'BOWL'] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export const PLAYER_ROLE_LABELS: Record<PlayerRole, { short: string; long: string }> = {
  WK: { short: 'WK', long: 'Wicket-keeper' },
  BAT: { short: 'BAT', long: 'Batter' },
  AR: { short: 'AR', long: 'All-rounder' },
  BOWL: { short: 'BOWL', long: 'Bowler' },
};

export interface SportDto {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
}

export interface TeamDto {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  color: string;
}

export interface SeriesDto {
  id: string;
  name: string;
  shortName: string | null;
}

export interface MatchSummaryDto {
  id: string;
  sportKey: string;
  series: SeriesDto;
  format: string;
  venue: string;
  city: string | null;
  /** ISO timestamp; also the team-edit deadline. */
  startTime: string;
  status: MatchStatus;
  statusNote: string | null;
  home: TeamDto;
  away: TeamDto;
  lineupsAnnounced: boolean;
  contestCount: number;
}

export interface PlayerStatsDto {
  matches: number;
  runs: number;
  wickets: number;
  battingAverage: number | null;
  strikeRate: number | null;
  economy: number | null;
  /** Fantasy points in the player's last five matches, most recent first. */
  recentPoints: number[];
}

export interface MatchPlayerDto {
  id: string;
  name: string;
  shortName: string;
  role: PlayerRole;
  /** Fantasy credits for this match, e.g. 8.5. */
  credits: number;
  teamId: string;
  imageUrl: string | null;
  country: string | null;
  /** null until lineups are announced. */
  isPlaying: boolean | null;
  stats: PlayerStatsDto | null;
}

export interface MatchDetailDto extends MatchSummaryDto {
  squads: { team: TeamDto; players: MatchPlayerDto[] }[];
}

export interface HomeFeedDto {
  live: MatchSummaryDto[];
  upcoming: MatchSummaryDto[];
  completed: MatchSummaryDto[];
}

export interface PageDto<T> {
  items: T[];
  nextCursor: string | null;
}
