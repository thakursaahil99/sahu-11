import { BadRequestException, Body, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  adminContestSchema,
  adminListQuerySchema,
  breakupTotal,
  cancelSchema,
  defaultScoringFor,
  fantasyRulesSchema,
  playerUpdateSchema,
  scoringRulesSchema,
  type AdminListQuery,
} from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { Env, InjectEnv } from '../config/config.module';
import { paidContestsEnabled } from '../config/env';
import { parseBreakup, toStoredBreakup } from '../contests/contest.mapper';
import { LiveScoringService } from '../live/live-scoring.service';
import { ScoringConfigService } from '../live/scoring-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { SportsSyncService } from '../sports/sports-sync.service';
import { FantasyConfigService, toRules } from '../teams/fantasy-config.service';
import { AdminController, Perm, Sensitive } from './admin.guard';
import { cursorArgs, page } from './admin-users';

const teamSel = { select: { id: true, name: true, shortName: true, color: true } } as const;

@AdminController('matches')
export class AdminMatchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveScoringService,
    private readonly sync: SportsSyncService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('matches.manage')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const where: Prisma.MatchWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.q ? { OR: [{ homeTeam: { shortName: { contains: q.q, mode: 'insensitive' } } }, { awayTeam: { shortName: { contains: q.q, mode: 'insensitive' } } }, { series: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    // Upcoming: soonest first; everything else: most recent first.
    const order: Prisma.MatchOrderByWithRelationInput[] = q.status === 'UPCOMING' ? [{ startTime: 'asc' }, { id: 'asc' }] : [{ startTime: 'desc' }, { id: 'desc' }];
    const rows = await this.prisma.match.findMany({
      where,
      orderBy: order,
      ...cursorArgs(q),
      include: { homeTeam: teamSel, awayTeam: teamSel, series: { select: { name: true } }, _count: { select: { contests: true, userTeams: true } } },
    });
    return page(rows, q.limit);
  }

  @Get(':id')
  @Perm('matches.manage')
  async detail(@Param('id') id: string) {
    const m = await this.prisma.match.findUnique({
      where: { id },
      include: { homeTeam: teamSel, awayTeam: teamSel, series: { select: { name: true } }, liveState: true, contests: { orderBy: { createdAt: 'asc' } } },
    });
    if (!m) throw new NotFoundException('Match not found');
    return { ...m, contests: m.contests.map((c) => ({ ...c, entryFee: c.entryFeeX100 / 100, prizePool: c.prizePoolX100 / 100, prizeBreakup: parseBreakup(c.prizeBreakup) })) };
  }

  /** Re-runs the live pipeline for one match (after a scoring-rule change or a provider fix). */
  @Post(':id/recompute')
  @HttpCode(200)
  @Perm('matches.manage')
  async recompute(@Param('id') id: string, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const m = await this.prisma.match.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Match not found');
    if (m.status === 'UPCOMING') throw new BadRequestException('The match hasn’t started');
    await this.prisma.matchLiveState.updateMany({ where: { matchId: id }, data: { hash: 'force-recompute' } });
    await this.live.processMatch(m);
    await this.audit.log({ action: 'admin.match_recomputed', actorId: admin.id, entityType: 'Match', entityId: id, meta });
    return { ok: true };
  }

  @Post(':id/abandon')
  @HttpCode(200)
  @Perm('matches.manage')
  @Sensitive()
  async abandon(@Param('id') id: string, @Body(zodBody(cancelSchema)) body: z.output<typeof cancelSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const m = await this.prisma.match.findUnique({ where: { id }, select: { status: true } });
    if (!m) throw new NotFoundException('Match not found');
    if (m.status === 'COMPLETED' || m.status === 'ABANDONED') throw new BadRequestException(`The match is already ${m.status.toLowerCase()}`);
    const contests = await this.live.abandonMatch(id, body.reason);
    await this.audit.log({ action: 'admin.match_abandoned', actorId: admin.id, entityType: 'Match', entityId: id, metadata: { reason: body.reason, contests }, meta });
    return { ok: true, contestsCancelled: contests };
  }

  @Post('sync')
  @HttpCode(200)
  @Perm('sports.sync')
  async runSync(@CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const result = await this.sync.sync();
    await this.audit.log({ action: 'admin.sports_sync', actorId: admin.id, metadata: { ...result }, meta });
    return result;
  }
}

@AdminController('players')
export class AdminPlayersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('players.manage')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const where: Prisma.PlayerWhereInput = q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { team: { shortName: { contains: q.q, mode: 'insensitive' } } }] } : {};
    const rows = await this.prisma.player.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...cursorArgs(q), include: { team: teamSel } });
    const p = page(rows, q.limit);
    return { ...p, items: p.items.map(({ stats: _s, ...pl }) => ({ ...pl, credits: pl.creditsX10 / 10 })) };
  }

  /** Price changes apply to new teams only — saved teams keep the credits they were built with. */
  @Put(':id')
  @Perm('players.manage')
  async update(@Param('id') id: string, @Body(zodBody(playerUpdateSchema)) body: z.output<typeof playerUpdateSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const before = await this.prisma.player.findUnique({ where: { id }, select: { creditsX10: true, role: true } });
    if (!before) throw new NotFoundException('Player not found');
    const p = await this.prisma.player.update({ where: { id }, data: { ...(body.credits !== undefined ? { creditsX10: Math.round(body.credits * 10) } : {}), ...(body.role ? { role: body.role } : {}) } });
    await this.audit.log({ action: 'admin.player_updated', actorId: admin.id, entityType: 'Player', entityId: id, metadata: { before: { credits: before.creditsX10 / 10, role: before.role }, after: body }, meta });
    return { ...p, credits: p.creditsX10 / 10 };
  }
}

@AdminController('config')
export class AdminConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringConfigService,
    private readonly fantasy: FantasyConfigService,
    private readonly audit: AuditService,
  ) {}

  @Get('scoring')
  @Perm('scoring.edit')
  async scoringList() {
    const sports = await this.prisma.sport.findMany({ where: { enabled: true }, select: { id: true, key: true, name: true } });
    const formats = ['T20', 'T10', 'ODI'];
    // Materialise rows (from defaults) so every format is editable.
    for (const s of sports) for (const f of formats) await this.scoring.rulesFor(s.id, f);
    const rows = await this.prisma.scoringConfig.findMany({ where: { sportId: { in: sports.map((s) => s.id) } }, orderBy: [{ sportId: 'asc' }, { format: 'asc' }] });
    return rows.map((r) => ({ id: r.id, sport: sports.find((s) => s.id === r.sportId)!, format: r.format, rules: { ...defaultScoringFor(r.format), ...(r.rules as object) }, updatedAt: r.updatedAt, updatedById: r.updatedById }));
  }

  @Put('scoring/:id')
  @Perm('scoring.edit')
  @Sensitive()
  async scoringUpdate(@Param('id') id: string, @Body(zodBody(scoringRulesSchema)) body: z.output<typeof scoringRulesSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const before = await this.prisma.scoringConfig.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Scoring table not found');
    await this.prisma.scoringConfig.update({ where: { id }, data: { rules: body as unknown as Prisma.InputJsonObject, updatedById: admin.id } });
    this.scoring.invalidate();
    await this.audit.log({ action: 'admin.scoring_updated', actorId: admin.id, entityType: 'ScoringConfig', entityId: id, metadata: { format: before.format, before: before.rules, after: body } as Prisma.InputJsonObject, meta });
    return { ok: true };
  }

  @Get('fantasy')
  @Perm('fantasy.edit')
  async fantasyList() {
    const sports = await this.prisma.sport.findMany({ select: { id: true, key: true, name: true, enabled: true } });
    return Promise.all(sports.map(async (s) => ({ sport: s, rules: await this.fantasy.forSport(s.id) })));
  }

  @Put('fantasy/:sportId')
  @Perm('fantasy.edit')
  @Sensitive()
  async fantasyUpdate(@Param('sportId') sportId: string, @Body(zodBody(fantasyRulesSchema)) r: z.output<typeof fantasyRulesSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const before = await this.prisma.fantasyConfig.findUnique({ where: { sportId } });
    if (!before) throw new NotFoundException('Sport not found');
    const row = await this.prisma.fantasyConfig.update({
      where: { sportId },
      data: {
        teamSize: r.teamSize,
        maxCreditsX10: Math.round(r.maxCredits * 10),
        maxPerTeam: r.maxPerTeam,
        minWk: r.roleLimits.WK.min,
        maxWk: r.roleLimits.WK.max,
        minBat: r.roleLimits.BAT.min,
        maxBat: r.roleLimits.BAT.max,
        minAr: r.roleLimits.AR.min,
        maxAr: r.roleLimits.AR.max,
        minBowl: r.roleLimits.BOWL.min,
        maxBowl: r.roleLimits.BOWL.max,
        maxTeamsPerMatch: r.maxTeamsPerMatch,
        captainMultiplierX100: Math.round(r.captainMultiplier * 100),
        viceCaptainMultiplierX100: Math.round(r.viceCaptainMultiplier * 100),
        updatedById: admin.id,
      },
    });
    this.fantasy.invalidate(sportId);
    await this.audit.log({ action: 'admin.fantasy_updated', actorId: admin.id, entityType: 'FantasyConfig', entityId: sportId, metadata: { before: toRules(before), after: r } as unknown as Prisma.InputJsonObject, meta });
    return toRules(row);
  }
}

@AdminController('contests')
export class AdminContestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveScoringService,
    private readonly audit: AuditService,
    @InjectEnv() private readonly env: Env,
  ) {}

  @Get()
  @Perm('contests.manage')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const where: Prisma.ContestWhereInput = {
      ...(q.matchId ? { matchId: q.matchId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.type ? { type: q.type as never } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { inviteCode: q.q.toUpperCase() }] } : {}),
    };
    const rows = await this.prisma.contest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
      include: { match: { select: { id: true, startTime: true, status: true, homeTeam: teamSel, awayTeam: teamSel } } },
    });
    const p = page(rows, q.limit);
    return { ...p, items: p.items.map((c) => ({ ...c, entryFee: c.entryFeeX100 / 100, prizePool: c.prizePoolX100 / 100, prizeBreakup: parseBreakup(c.prizeBreakup) })) };
  }

  @Post()
  @Perm('contests.manage')
  async create(@Body(zodBody(adminContestSchema)) b: z.output<typeof adminContestSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    if (b.type === 'PUBLIC' && !paidContestsEnabled(this.env)) throw new ForbiddenException('Paid contests are switched off (demo mode or compliance not confirmed)');
    const match = await this.prisma.match.findUnique({ where: { id: b.matchId }, select: { status: true, startTime: true } });
    if (!match) throw new NotFoundException('Match not found');
    if (match.status !== 'UPCOMING' || match.startTime <= new Date()) throw new BadRequestException('Contests can only be added before the match starts');
    const currency = b.type === 'PRACTICE' ? 'NONE' : b.type === 'PUBLIC' ? 'INR' : this.env.APP_MODE === 'demo' ? 'DEMO' : 'NONE';
    if (b.type === 'FREE' && currency === 'NONE' && b.prizePool > 0) throw new BadRequestException('Free contests can’t pay cash prizes');
    const c = await this.prisma.contest.create({
      data: {
        matchId: b.matchId,
        type: b.type,
        name: b.name,
        entryFeeX100: Math.round(b.entryFee * 100),
        prizePoolX100: Math.round(breakupTotal(b.prizeBreakup) * 100),
        currency,
        totalSpots: b.totalSpots,
        maxEntriesPerUser: b.maxEntriesPerUser,
        guaranteed: b.guaranteed,
        prizeBreakup: toStoredBreakup(b.prizeBreakup) as unknown as Prisma.InputJsonArray,
        createdById: admin.id,
      },
    });
    await this.audit.log({ action: 'admin.contest_created', actorId: admin.id, entityType: 'Contest', entityId: c.id, metadata: b as unknown as Prisma.InputJsonObject, meta });
    return c;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Perm('contests.manage')
  @Sensitive()
  async cancel(@Param('id') id: string, @Body(zodBody(cancelSchema)) body: z.output<typeof cancelSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const ok = await this.live.cancelContest(id, body.reason);
    if (!ok) throw new BadRequestException('Only open or running contests can be cancelled');
    await this.audit.log({ action: 'admin.contest_cancelled', actorId: admin.id, entityType: 'Contest', entityId: id, metadata: { reason: body.reason }, meta });
    return { ok: true };
  }

  /** Final standings with winnings (read-only: settlement is automatic and happens once). */
  @Get(':id/results')
  @Perm('contests.manage')
  async results(@Param('id') id: string) {
    const c = await this.prisma.contest.findUnique({ where: { id }, select: { id: true, name: true, status: true, currency: true, settledAt: true, prizePoolX100: true, prizeBreakup: true } });
    if (!c) throw new NotFoundException('Contest not found');
    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId: id },
      orderBy: [{ rank: 'asc' }, { pointsX10: 'desc' }],
      take: 500,
      select: { id: true, rank: true, pointsX10: true, winningsX100: true, user: { select: { id: true, name: true } }, team: { select: { teamNumber: true } } },
    });
    return {
      contest: { ...c, prizePool: c.prizePoolX100 / 100, prizeBreakup: parseBreakup(c.prizeBreakup) },
      paidOut: entries.reduce((s, e) => s + e.winningsX100, 0) / 100,
      entries: entries.map((e) => ({ id: e.id, rank: e.rank, points: e.pointsX10 / 10, winnings: e.winningsX100 / 100, user: e.user, team: `T${e.team.teamNumber}` })),
    };
  }
}
