import type { ContestStatus, ContestType } from './contests';
import type { MatchStatus } from './sports';

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotificationType =
  | 'MATCH_REMINDER'
  | 'MATCH_START'
  | 'CONTEST_JOINED'
  | 'CONTEST_RESULT'
  | 'CONTEST_CANCELLED'
  | 'TRANSACTION'
  | 'KYC'
  | 'SUPPORT'
  | 'ANNOUNCEMENT';

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** In-app route to open on tap, e.g. /contest/abc. */
  url: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPageDto {
  items: NotificationDto[];
  nextCursor: string | null;
  unread: number;
}

/** Private Socket.IO room every connection joins automatically. */
export const userRoom = (userId: string) => `user:${userId}`;
export const USER_EVENTS = { notification: 'notification:new' } as const;

export type PushTokenKind = 'EXPO' | 'FCM';
export type PushPlatform = 'ANDROID' | 'IOS' | 'WEB';

// ─── History ────────────────────────────────────────────────────────────────

export interface MyContestDto {
  entryId: string;
  contestId: string;
  contestName: string;
  contestType: ContestType;
  contestStatus: ContestStatus;
  currency: 'DEMO' | 'INR' | 'NONE';
  matchId: string;
  matchTitle: string;
  matchStatus: MatchStatus;
  startTime: string;
  teamName: string;
  points: number;
  rank: number | null;
  totalSpots: number;
  winnings: number;
}

export interface PointsHistoryPoint {
  matchId: string;
  label: string;
  startTime: string;
  /** Best team score in that match. */
  points: number;
}

export interface ProfileStatsDto {
  contests: number;
  teams: number;
  matches: number;
  wins: number;
  bestRank: number | null;
  winnings: { DEMO: number; INR: number };
  /** Oldest → newest, last 10 completed matches. */
  recent: PointsHistoryPoint[];
}

// ─── Support ────────────────────────────────────────────────────────────────

export const TICKET_CATEGORIES = ['ACCOUNT', 'PAYMENTS', 'CONTESTS', 'KYC', 'TECHNICAL', 'OTHER'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketStatus = 'OPEN' | 'AWAITING_USER' | 'RESOLVED' | 'CLOSED';

export interface SupportTicketDto {
  id: string;
  reference: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  lastMessage: string;
  lastMessageAt: string;
  createdAt: string;
}

export interface SupportMessageDto {
  id: string;
  fromStaff: boolean;
  body: string;
  createdAt: string;
}

export interface SupportTicketDetailDto extends SupportTicketDto {
  messages: SupportMessageDto[];
}

// ─── Responsible play ───────────────────────────────────────────────────────

export interface DepositLimits {
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
}

export type PlayStatus = 'ACTIVE' | 'ON_BREAK' | 'RESTRICTED';

export interface ResponsiblePlayDto {
  status: PlayStatus;
  limits: DepositLimits;
  /** Raised or removed limits waiting out the cooling-off period (only the windows that change). */
  pending: Partial<DepositLimits> | null;
  pendingEffectiveAt: string | null;
  /** Rupees deposited in the current day / 7 days / 30 days. */
  usage: DepositLimits & { daily: number; weekly: number; monthly: number };
  excludedUntil: string | null;
  restrictionReason: string | null;
}
