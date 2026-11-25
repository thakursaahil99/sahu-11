import type { ScoreLine } from '../fantasy/scoring';
import type { ContestStatus } from './contests';
import type { MatchStatus, MatchSummaryDto, PlayerRole } from './sports';

export interface InningsDto {
  teamId: string;
  teamShortName: string;
  runs: number;
  wickets: number;
  /** Legal deliveries. */
  balls: number;
  /** "12.3" */
  overs: string;
  target: number | null;
}

export interface LiveScoreDto {
  innings: InningsDto[];
  /** Last few deliveries, oldest first: "•", "1", "4", "6", "W", "Wd". */
  recentBalls: string[];
  final: boolean;
  updatedAt: string;
}

export interface PlayerPointsDto {
  playerId: string;
  name: string;
  shortName: string;
  role: PlayerRole;
  teamId: string;
  imageUrl: string | null;
  isPlaying: boolean | null;
  /** Base fantasy points (no captain multiplier). */
  points: number;
  lines: ScoreLine[];
  /** Percent of teams in this match that picked the player. */
  selectedBy: number;
}

export interface MatchLiveDto {
  match: MatchSummaryDto;
  score: LiveScoreDto | null;
  /** Sorted by points, highest first. */
  players: PlayerPointsDto[];
  myTeams: { teamId: string; name: string; points: number }[];
}

export interface EntryPlayerDto extends PlayerPointsDto {
  credits: number;
  /** 2 for captain, 1.5 for vice-captain, otherwise 1. */
  multiplier: number;
  /** points × multiplier */
  total: number;
}

/** One team inside a contest, with every player's points — the "points breakdown". */
export interface EntryTeamDto {
  entryId: string;
  contestId: string;
  userName: string;
  isMe: boolean;
  teamName: string;
  points: number;
  rank: number | null;
  winnings: number;
  captainId: string;
  viceCaptainId: string;
  players: EntryPlayerDto[];
  match: MatchSummaryDto;
}

// ─── Socket.IO contract (namespace /live) ──────────────────────────────────

export const LIVE_NAMESPACE = '/live';
export const contestRoom = (contestId: string) => `contest:${contestId}`;
export const matchRoom = (matchId: string) => `match:${matchId}`;

export interface LeaderboardChange {
  entryId: string;
  points: number;
  rank: number | null;
}

/** Server → client: only entries whose points or rank changed since the last push. */
export interface LeaderboardDeltaEvent {
  contestId: string;
  changes: LeaderboardChange[];
  at: string;
}

export interface MatchLiveEvent {
  matchId: string;
  status: MatchStatus;
  statusNote: string | null;
  score: LiveScoreDto | null;
  at: string;
}

export interface ContestStatusEvent {
  contestId: string;
  status: ContestStatus;
  at: string;
}

export const LIVE_EVENTS = {
  leaderboard: 'leaderboard:delta',
  match: 'match:live',
  contest: 'contest:status',
} as const;
