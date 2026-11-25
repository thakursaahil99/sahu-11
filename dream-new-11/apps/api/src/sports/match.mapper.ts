import type { Match, MatchPlayer, Player, Series, Sport, Team } from '@prisma/client';
import type { MatchDetailDto, MatchPlayerDto, MatchSummaryDto, PlayerRole, PlayerStatsDto, TeamDto } from '@dream11/shared';

export const matchSummaryInclude = {
  sport: { select: { key: true } },
  series: true,
  homeTeam: true,
  awayTeam: true,
} as const;

type MatchWithRelations = Match & { sport: Pick<Sport, 'key'>; series: Series; homeTeam: Team; awayTeam: Team };

export const toTeamDto = (t: Team): TeamDto => ({
  id: t.id,
  name: t.name,
  shortName: t.shortName,
  logoUrl: t.logoUrl,
  color: t.color,
});

export function toMatchSummary(m: MatchWithRelations, contestCount: number): MatchSummaryDto {
  return {
    id: m.id,
    sportKey: m.sport.key,
    series: { id: m.series.id, name: m.series.name, shortName: m.series.shortName },
    format: m.format,
    venue: m.venue,
    city: m.city,
    startTime: m.startTime.toISOString(),
    status: m.status,
    statusNote: m.statusNote,
    home: toTeamDto(m.homeTeam),
    away: toTeamDto(m.awayTeam),
    lineupsAnnounced: m.lineupsAnnounced,
    contestCount,
  };
}

const ROLE_ORDER: Record<PlayerRole, number> = { WK: 0, BAT: 1, AR: 2, BOWL: 3 };

function toStats(json: unknown): PlayerStatsDto | null {
  if (!json || typeof json !== 'object') return null;
  const s = json as Partial<PlayerStatsDto>;
  return {
    matches: s.matches ?? 0,
    runs: s.runs ?? 0,
    wickets: s.wickets ?? 0,
    battingAverage: s.battingAverage ?? null,
    strikeRate: s.strikeRate ?? null,
    economy: s.economy ?? null,
    recentPoints: Array.isArray(s.recentPoints) ? s.recentPoints.slice(0, 5) : [],
  };
}

export function toMatchPlayer(mp: MatchPlayer & { player: Player }): MatchPlayerDto {
  return {
    id: mp.player.id,
    name: mp.player.name,
    shortName: mp.player.shortName,
    role: mp.role,
    credits: mp.creditsX10 / 10,
    teamId: mp.teamId,
    imageUrl: mp.player.imageUrl,
    country: mp.player.country,
    isPlaying: mp.isPlaying,
    stats: toStats(mp.player.stats),
  };
}

export function toMatchDetail(
  m: MatchWithRelations & { squad: (MatchPlayer & { player: Player })[] },
  contestCount: number,
): MatchDetailDto {
  const sorted = [...m.squad].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.creditsX10 - a.creditsX10 || a.player.name.localeCompare(b.player.name),
  );
  return {
    ...toMatchSummary(m, contestCount),
    squads: [m.homeTeam, m.awayTeam].map((team) => ({
      team: toTeamDto(team),
      players: sorted.filter((p) => p.teamId === team.id).map(toMatchPlayer),
    })),
  };
}
