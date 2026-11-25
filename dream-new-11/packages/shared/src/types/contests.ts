import type { MatchSummaryDto } from './sports';

export const CONTEST_TYPES = ['PRACTICE', 'FREE', 'PRIVATE', 'PUBLIC'] as const;
export type ContestType = (typeof CONTEST_TYPES)[number];

export const CONTEST_STATUSES = ['OPEN', 'LOCKED', 'COMPLETED', 'CANCELLED'] as const;
export type ContestStatus = (typeof CONTEST_STATUSES)[number];

/** NONE = bragging rights only, DEMO = demo credits (no cash value), INR = real money. */
export type PrizeCurrency = 'NONE' | 'DEMO' | 'INR';

export interface PrizeTier {
  fromRank: number;
  toRank: number;
  /** Prize per rank in this tier. */
  amount: number;
}

export interface ContestSummaryDto {
  id: string;
  matchId: string;
  type: ContestType;
  name: string;
  status: ContestStatus;
  entryFee: number;
  isPaid: boolean;
  prizePool: number;
  currency: PrizeCurrency;
  totalSpots: number;
  filledSpots: number;
  spotsLeft: number;
  maxEntriesPerUser: number;
  guaranteed: boolean;
  firstPrize: number;
  /** Number of winning ranks. */
  winners: number;
  /** Teams already entered by the current user. */
  myEntries: number;
  /** Only present for private contests the user created or joined. */
  inviteCode: string | null;
  createdByMe: boolean;
  cancelReason: string | null;
}

export interface MyEntryDto {
  entryId: string;
  teamId: string;
  teamName: string;
  points: number;
  rank: number | null;
  winnings: number;
}

export interface LeaderboardRowDto {
  entryId: string;
  userName: string;
  avatarUrl: string | null;
  teamName: string;
  points: number;
  rank: number | null;
  isMe: boolean;
}

export interface ContestDetailDto extends ContestSummaryDto {
  match: MatchSummaryDto;
  prizeBreakup: PrizeTier[];
  rules: string[];
  myTeams: MyEntryDto[];
  leaderboard: LeaderboardRowDto[];
  /** True while the contest can still be joined or teams switched. */
  joinable: boolean;
}

export interface MatchContestsDto {
  contests: ContestSummaryDto[];
  /** Private contests the user created or joined for this match. */
  myPrivate: ContestSummaryDto[];
  paidContestsEnabled: boolean;
}

export interface InviteLookupDto {
  contest: ContestSummaryDto;
  match: MatchSummaryDto;
  createdByName: string;
}

export interface JoinResultDto {
  contest: ContestSummaryDto;
  joinedTeamIds: string[];
}

export interface MyMatchDto {
  match: MatchSummaryDto;
  contestsJoined: number;
  teamsCreated: number;
}
