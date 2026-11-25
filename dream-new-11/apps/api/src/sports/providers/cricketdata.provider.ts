import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { emptyStats } from '@dream11/shared';
import type { MatchStatus, PlayerMatchStats, PlayerRole } from '@dream11/shared';
import { colorFromName, ProviderFixture, ProviderLiveState, ProviderSquad, ProviderTeam, shortPlayerName, SportsProvider } from './sports-provider';

/**
 * CricketData.org (cricapi) v1. Responses are validated with zod, so a change in the
 * provider's shape fails loudly instead of writing bad data.
 *
 * Notes:
 * - The free plan has a small daily request quota; keep SPORTS_SYNC_INTERVAL_SECONDS high (≥ 1800).
 * - The API has no fantasy credit values, so every player starts at DEFAULT_CREDITS.
 *   Adjust prices in the admin panel (Phase 8) before opening contests.
 */
const BASE_URL = 'https://api.cricapi.com/v1';
const DEFAULT_CREDITS = 8;
const PAGE_SIZE = 25;
const MAX_PAGES = 4;

const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ status: z.string(), reason: z.string().optional(), data: data.optional() });

const teamInfoSchema = z.object({ name: z.string(), shortname: z.string().optional(), img: z.string().optional() });

const matchSchema = z.object({
  id: z.string(),
  name: z.string(),
  matchType: z.string().optional(),
  status: z.string().optional(),
  venue: z.string().optional(),
  dateTimeGMT: z.string(),
  teams: z.array(z.string()).min(2),
  teamInfo: z.array(teamInfoSchema).optional(),
  series_id: z.string().optional(),
  matchStarted: z.boolean().optional(),
  matchEnded: z.boolean().optional(),
  hasSquad: z.boolean().optional(),
});

const squadSchema = z.array(
  z.object({
    teamName: z.string(),
    shortname: z.string().optional(),
    img: z.string().optional(),
    players: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string().optional(),
        battingStyle: z.string().optional(),
        bowlingStyle: z.string().optional(),
        country: z.string().optional(),
        playerImg: z.string().optional(),
      }),
    ),
  }),
);

const ref = z.object({ id: z.string() }).passthrough();
const num = z.coerce.number().optional();
const scorecardSchema = z
  .object({
    status: z.string().optional(),
    matchStarted: z.boolean().optional(),
    matchEnded: z.boolean().optional(),
    score: z.array(z.object({ r: num, w: num, o: z.union([z.number(), z.string()]).optional(), inning: z.string().optional() }).passthrough()).optional(),
    scorecard: z
      .array(
        z
          .object({
            batting: z.array(z.object({ batsman: ref, r: num, b: num, '4s': num, '6s': num, dismissal: z.string().optional(), bowler: ref.optional() }).passthrough()).optional(),
            bowling: z.array(z.object({ bowler: ref, o: z.union([z.number(), z.string()]).optional(), m: num, r: num, w: num }).passthrough()).optional(),
            catching: z.array(z.object({ catcher: ref, catch: num, stumped: num, runout: num }).passthrough()).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const seriesInfoSchema = z.object({ info: z.object({ name: z.string() }).passthrough() }).passthrough();

function mapRole(role = ''): PlayerRole {
  const r = role.toLowerCase();
  if (r.includes('wk') || r.includes('keeper')) return 'WK';
  if (r.includes('allrounder') || r.includes('all-rounder')) return 'AR';
  if (r.includes('bowl')) return 'BOWL';
  return 'BAT';
}

function mapStatus(m: z.infer<typeof matchSchema>): MatchStatus {
  if (m.matchEnded) return /abandon|no result/i.test(m.status ?? '') ? 'ABANDONED' : 'COMPLETED';
  return m.matchStarted ? 'LIVE' : 'UPCOMING';
}

/** Placeholder images the API returns for unknown logos/players. */
const realImage = (url?: string) => (url && !/icon512|placeholder/i.test(url) ? url : null);

function team(name: string, info?: z.infer<typeof teamInfoSchema>): ProviderTeam {
  const shortName = (info?.shortname ?? name.slice(0, 3)).toUpperCase();
  return { externalId: name, name, shortName, logoUrl: realImage(info?.img), color: colorFromName(name) };
}

export class CricketDataProvider implements SportsProvider {
  readonly name = 'cricketdata';
  private readonly logger = new Logger(CricketDataProvider.name);
  private readonly seriesNames = new Map<string, string>();

  constructor(private readonly apiKey: string) {}

  async fetchFixtures(from: Date, to: Date): Promise<ProviderFixture[]> {
    const raw: z.infer<typeof matchSchema>[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.get('matches', { offset: String(page * PAGE_SIZE) }, z.array(matchSchema));
      raw.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    const fixtures: ProviderFixture[] = [];
    for (const m of raw) {
      const startTime = new Date(m.dateTimeGMT.endsWith('Z') ? m.dateTimeGMT : `${m.dateTimeGMT}Z`);
      if (Number.isNaN(startTime.getTime()) || startTime < from || startTime > to) continue;
      const [homeName, awayName] = m.teams as [string, string];
      const info = (n: string) => m.teamInfo?.find((t) => t.name === n);
      const format = (m.matchType ?? 't20').toUpperCase();
      const seriesId = m.series_id ?? `adhoc-${format}`;
      fixtures.push({
        externalId: m.id,
        sportKey: 'cricket',
        series: { externalId: seriesId, name: await this.seriesName(seriesId, m.name), shortName: null, format },
        home: team(homeName, info(homeName)),
        away: team(awayName, info(awayName)),
        venue: m.venue ?? 'Venue to be announced',
        city: m.venue?.split(',').pop()?.trim() ?? null,
        format,
        startTime,
        status: mapStatus(m),
        statusNote: m.status ?? null,
        lineupsAnnounced: !!m.matchStarted,
      });
    }
    return fixtures;
  }

  async fetchSquads(fixtureExternalId: string): Promise<ProviderSquad[]> {
    const squads = await this.get('match_squad', { id: fixtureExternalId }, squadSchema);
    return squads.map((s) => ({
      team: team(s.teamName, { name: s.teamName, shortname: s.shortname, img: s.img }),
      players: s.players.map((p) => ({
        externalId: p.id,
        name: p.name,
        shortName: shortPlayerName(p.name),
        role: mapRole(p.role),
        credits: DEFAULT_CREDITS,
        imageUrl: realImage(p.playerImg),
        battingStyle: p.battingStyle ?? null,
        bowlingStyle: p.bowlingStyle ?? null,
        country: p.country ?? null,
        stats: null,
        isPlaying: null,
      })),
    }));
  }

  /**
   * Builds live fantasy stats from `match_scorecard`. The provider does not publish the full
   * playing XI here, so only players who batted, bowled or fielded are marked as playing.
   */
  async fetchLive(fixtureExternalId: string): Promise<ProviderLiveState | null> {
    const data = await this.get('match_scorecard', { id: fixtureExternalId }, scorecardSchema);
    if (!data.matchStarted) return null;

    const players: Record<string, PlayerMatchStats> = {};
    const p = (id: string) => (players[id] ??= { ...emptyStats(), inPlayingXI: true });

    for (const inn of data.scorecard ?? []) {
      for (const b of inn.batting ?? []) {
        const s = p(b.batsman.id);
        s.runs += b.r ?? 0;
        s.balls += b.b ?? 0;
        s.fours += b['4s'] ?? 0;
        s.sixes += b['6s'] ?? 0;
        const how = (b.dismissal ?? '').toLowerCase();
        if (how && how !== 'not out') s.out = true;
        if (b.bowler?.id && (how === 'bowled' || how === 'lbw')) p(b.bowler.id).lbwBowled += 1;
      }
      for (const bw of inn.bowling ?? []) {
        const s = p(bw.bowler.id);
        const [full, part] = String(bw.o ?? 0).split('.');
        s.ballsBowled += Number(full) * 6 + Number(part ?? 0);
        s.runsConceded += bw.r ?? 0;
        s.wickets += bw.w ?? 0;
        s.maidens += bw.m ?? 0;
      }
      for (const c of inn.catching ?? []) {
        const s = p(c.catcher.id);
        s.catches += c.catch ?? 0;
        s.stumpings += c.stumped ?? 0;
        // The feed doesn't distinguish direct hits from assists; count them as direct.
        s.runOutDirect += c.runout ?? 0;
      }
    }

    const innings = (data.score ?? []).map((sc, i) => {
      const [full, part] = String(sc.o ?? 0).split('.');
      const battingName = (sc.inning ?? '').replace(/\s+Inning.*$/i, '').trim();
      return {
        battingTeamExternalId: battingName,
        runs: sc.r ?? 0,
        wickets: sc.w ?? 0,
        balls: Number(full) * 6 + Number(part ?? 0),
        target: i === 1 ? (data.score?.[0]?.r ?? 0) + 1 : null,
      };
    });

    const status: MatchStatus = data.matchEnded ? (/abandon|no result/i.test(data.status ?? '') ? 'ABANDONED' : 'COMPLETED') : 'LIVE';
    return { status, statusNote: data.status ?? null, innings, recentBalls: [], players, final: !!data.matchEnded };
  }

  private async seriesName(seriesId: string, matchName: string): Promise<string> {
    const cached = this.seriesNames.get(seriesId);
    if (cached) return cached;
    let name = matchName.split(',').slice(1).join(',').trim() || matchName;
    if (!seriesId.startsWith('adhoc-')) {
      try {
        name = (await this.get('series_info', { id: seriesId }, seriesInfoSchema)).info.name;
      } catch (err) {
        this.logger.warn(`series_info ${seriesId} failed, using match name: ${(err as Error).message}`);
      }
    }
    this.seriesNames.set(seriesId, name);
    return name;
  }

  private async get<T extends z.ZodTypeAny>(path: string, params: Record<string, string>, schema: T): Promise<z.infer<T>> {
    const url = `${BASE_URL}/${path}?${new URLSearchParams({ apikey: this.apiKey, ...params })}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new ServiceUnavailableException(`CricketData ${path} HTTP ${res.status}`);
    const parsed = envelope(schema).safeParse(await res.json());
    if (!parsed.success) throw new ServiceUnavailableException(`CricketData ${path}: unexpected response shape`);
    if (parsed.data.status !== 'success' || parsed.data.data === undefined) {
      throw new ServiceUnavailableException(`CricketData ${path}: ${parsed.data.reason ?? parsed.data.status}`);
    }
    return parsed.data.data as z.infer<T>;
  }
}
