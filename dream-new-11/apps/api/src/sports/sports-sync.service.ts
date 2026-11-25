import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Env, InjectEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderFixture, ProviderSeries, ProviderTeam, SPORTS_PROVIDER, SportsProvider } from './providers/sports-provider';

const DAY_MS = 86_400_000;
/** Fixtures window pulled from the provider on every run. */
const WINDOW_BACK_MS = 3 * DAY_MS;
const WINDOW_AHEAD_MS = 7 * DAY_MS;
/** Upcoming squads are refreshed this often once the match is within a day (prices / lineups move). */
const SQUAD_REFRESH_MS = 15 * 60_000;

export const SPORTS = [
  { key: 'cricket', name: 'Cricket', enabled: true, sortOrder: 0 },
  { key: 'football', name: 'Football', enabled: false, sortOrder: 1 },
] as const;

export interface SyncResult {
  fixtures: number;
  squads: number;
  durationMs: number;
}

/**
 * Pulls fixtures and squads from the configured SportsProvider into Postgres.
 * Runs on boot and then every SPORTS_SYNC_INTERVAL_SECONDS. Upserts are keyed on
 * (provider, externalId), so re-running is always safe.
 */
@Injectable()
export class SportsSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SportsSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<SyncResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SPORTS_PROVIDER) private readonly provider: SportsProvider,
    @InjectEnv() private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureSports();
    if (!this.env.SPORTS_SYNC_ENABLED) return;
    void this.sync();
    this.timer = setInterval(() => void this.sync(), this.env.SPORTS_SYNC_INTERVAL_SECONDS * 1000);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs one sync; concurrent callers share the in-flight run. */
  sync(): Promise<SyncResult> {
    this.running ??= this.run()
      .catch((err: unknown) => {
        this.logger.error(`Sync via ${this.provider.name} failed: ${err instanceof Error ? err.message : String(err)}`);
        return { fixtures: 0, squads: 0, durationMs: 0 };
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async ensureSports(): Promise<void> {
    for (const s of SPORTS) {
      await this.prisma.sport.upsert({ where: { key: s.key }, create: s, update: {} });
    }
  }

  private async run(): Promise<SyncResult> {
    const started = Date.now();
    // Cheap and idempotent; keeps sync working even if the sports table was reset while running.
    await this.ensureSports();
    const fixtures = await this.provider.fetchFixtures(new Date(started - WINDOW_BACK_MS), new Date(started + WINDOW_AHEAD_MS));
    const sports = new Map((await this.prisma.sport.findMany()).map((s) => [s.key, s.id]));
    const teamIds = new Map<string, string>();
    const seriesIds = new Map<string, string>();

    for (const f of fixtures) {
      const sportId = sports.get(f.sportKey);
      if (!sportId) continue;
      await this.upsertFixture(f, sportId, teamIds, seriesIds);
    }

    const squads = await this.syncSquads(teamIds);
    const result = { fixtures: fixtures.length, squads, durationMs: Date.now() - started };
    this.logger.log(`Synced ${result.fixtures} fixtures, ${result.squads} squads via ${this.provider.name} in ${result.durationMs}ms`);
    return result;
  }

  private async upsertFixture(f: ProviderFixture, sportId: string, teamIds: Map<string, string>, seriesIds: Map<string, string>) {
    const p = this.provider.name;
    const seriesId = await this.cached(seriesIds, f.series.externalId, () => this.upsertSeries(f.series, sportId));
    const homeTeamId = await this.cached(teamIds, f.home.externalId, () => this.upsertTeam(f.home, sportId));
    const awayTeamId = await this.cached(teamIds, f.away.externalId, () => this.upsertTeam(f.away, sportId));
    const data = {
      sportId,
      seriesId,
      homeTeamId,
      awayTeamId,
      venue: f.venue,
      city: f.city,
      format: f.format,
      startTime: f.startTime,
      status: f.status,
      statusNote: f.statusNote,
      lineupsAnnounced: f.lineupsAnnounced,
      lastSyncedAt: new Date(),
    };
    const where = { provider_externalId: { provider: p, externalId: f.externalId } };
    const existing = await this.prisma.match.findUnique({ where, select: { homeTeamId: true, awayTeamId: true } });
    // Teams can change after publication (e.g. "TBD vs TBD" playoffs); the old squad is then invalid.
    const teamsChanged = existing && (existing.homeTeamId !== homeTeamId || existing.awayTeamId !== awayTeamId);
    await this.prisma.match.upsert({
      where,
      create: { provider: p, externalId: f.externalId, ...data },
      update: teamsChanged ? { ...data, squadSyncedAt: null } : data,
    });
  }

  /** Fetches squads for matches that have none yet, or whose prices/lineups may have changed. */
  private async syncSquads(teamIds: Map<string, string>): Promise<number> {
    const now = Date.now();
    const due = await this.prisma.match.findMany({
      where: {
        provider: this.provider.name,
        OR: [
          // Any status: finished matches still need their squad for scoring.
          { squadSyncedAt: null },
          { status: 'UPCOMING', startTime: { lte: new Date(now + DAY_MS) }, squadSyncedAt: { lt: new Date(now - SQUAD_REFRESH_MS) } },
          // Lineups landed after our last squad fetch.
          { lineupsAnnounced: true, squadSyncedAt: { lt: new Date(now - SQUAD_REFRESH_MS) }, status: 'UPCOMING' },
        ],
      },
      select: { id: true, externalId: true, sportId: true },
      orderBy: { startTime: 'asc' },
      take: 40,
    });

    let count = 0;
    for (const m of due) {
      try {
        const squads = await this.provider.fetchSquads(m.externalId);
        if (squads.length === 0) continue;
        await this.writeSquad(m.id, m.sportId, squads, teamIds);
        count++;
      } catch (err) {
        this.logger.warn(`Squad sync for ${m.externalId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return count;
  }

  private async writeSquad(
    matchId: string,
    sportId: string,
    squads: Awaited<ReturnType<SportsProvider['fetchSquads']>>,
    teamIds: Map<string, string>,
  ): Promise<void> {
    const p = this.provider.name;
    const rows: Prisma.MatchPlayerCreateManyInput[] = [];
    for (const squad of squads) {
      const teamId = await this.cached(teamIds, squad.team.externalId, () => this.upsertTeam(squad.team, sportId));
      for (const pl of squad.players) {
        const creditsX10 = Math.round(pl.credits * 10);
        const data = {
          sportId,
          teamId,
          name: pl.name,
          shortName: pl.shortName,
          role: pl.role,
          creditsX10,
          imageUrl: pl.imageUrl,
          battingStyle: pl.battingStyle,
          bowlingStyle: pl.bowlingStyle,
          country: pl.country,
          stats: pl.stats ? (pl.stats as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
        };
        const player = await this.prisma.player.upsert({
          where: { provider_externalId: { provider: p, externalId: pl.externalId } },
          create: { provider: p, externalId: pl.externalId, ...data },
          update: data,
          select: { id: true },
        });
        rows.push({ matchId, playerId: player.id, teamId, role: pl.role, creditsX10, isPlaying: pl.isPlaying });
      }
    }
    // Replace the match squad atomically so readers never see a half-written list.
    await this.prisma.$transaction([
      this.prisma.matchPlayer.deleteMany({ where: { matchId } }),
      this.prisma.matchPlayer.createMany({ data: rows, skipDuplicates: true }),
      this.prisma.match.update({ where: { id: matchId }, data: { squadSyncedAt: new Date() } }),
    ]);
  }

  private async upsertSeries(s: ProviderSeries, sportId: string): Promise<string> {
    const p = this.provider.name;
    const data = { sportId, name: s.name, shortName: s.shortName, format: s.format };
    const row = await this.prisma.series.upsert({
      where: { provider_externalId: { provider: p, externalId: s.externalId } },
      create: { provider: p, externalId: s.externalId, ...data },
      update: data,
      select: { id: true },
    });
    return row.id;
  }

  private async upsertTeam(t: ProviderTeam, sportId: string): Promise<string> {
    const p = this.provider.name;
    const data = { sportId, name: t.name, shortName: t.shortName, logoUrl: t.logoUrl, color: t.color };
    const row = await this.prisma.team.upsert({
      where: { provider_externalId: { provider: p, externalId: t.externalId } },
      create: { provider: p, externalId: t.externalId, ...data },
      update: data,
      select: { id: true },
    });
    return row.id;
  }

  private async cached(map: Map<string, string>, key: string, load: () => Promise<string>): Promise<string> {
    const hit = map.get(key);
    if (hit) return hit;
    const id = await load();
    map.set(key, id);
    return id;
  }
}
