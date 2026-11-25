import type { MatchStatus, PlayerMatchStats, PlayerRole, PlayerStatsDto } from '@dream11/shared';

export interface ProviderTeam {
  externalId: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  color: string;
}

export interface ProviderSeries {
  externalId: string;
  name: string;
  shortName: string | null;
  format: string;
}

export interface ProviderFixture {
  externalId: string;
  sportKey: string;
  series: ProviderSeries;
  home: ProviderTeam;
  away: ProviderTeam;
  venue: string;
  city: string | null;
  format: string;
  startTime: Date;
  status: MatchStatus;
  statusNote: string | null;
  lineupsAnnounced: boolean;
}

export interface ProviderPlayer {
  externalId: string;
  name: string;
  shortName: string;
  role: PlayerRole;
  /** Fantasy credits, e.g. 8.5. */
  credits: number;
  imageUrl: string | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  country: string | null;
  stats: PlayerStatsDto | null;
  /** null until lineups are announced. */
  isPlaying: boolean | null;
}

export interface ProviderSquad {
  team: ProviderTeam;
  players: ProviderPlayer[];
}

export interface ProviderInnings {
  battingTeamExternalId: string;
  runs: number;
  wickets: number;
  /** Legal deliveries bowled. */
  balls: number;
  target: number | null;
}

/** Live (or final) scorecard plus per-player fantasy-relevant numbers, keyed by player externalId. */
export interface ProviderLiveState {
  status: MatchStatus;
  statusNote: string | null;
  innings: ProviderInnings[];
  /** Last few deliveries, oldest first: "•", "1", "4", "6", "W", "Wd"… */
  recentBalls: string[];
  players: Record<string, PlayerMatchStats>;
  /** True once the provider has final, settled numbers. */
  final: boolean;
}

/**
 * Source of fixtures and squads. Implementations: MockProvider (demo) and
 * CricketDataProvider (production). Selected with SPORTS_PROVIDER.
 */
export interface SportsProvider {
  readonly name: string;
  fetchFixtures(from: Date, to: Date): Promise<ProviderFixture[]>;
  fetchSquads(fixtureExternalId: string): Promise<ProviderSquad[]>;
  /** Live scorecard for a started match, or null if the provider has nothing yet. */
  fetchLive(fixtureExternalId: string): Promise<ProviderLiveState | null>;
}

export const SPORTS_PROVIDER = Symbol('SPORTS_PROVIDER');

/** Stable pleasant colour for a team that has no brand colour from the provider. */
export function colorFromName(name: string): string {
  const palette = ['#1E88E5', '#E53935', '#FBC02D', '#7E57C2', '#EF6C00', '#00ACC1', '#EC407A', '#43A047', '#8D6E63', '#5C6BC0'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}

/** "Virat Kohli" → "V Kohli". */
export function shortPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]![0]} ${parts.slice(1).join(' ')}`;
}
