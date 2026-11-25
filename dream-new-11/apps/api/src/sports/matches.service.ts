import { Injectable, NotFoundException } from '@nestjs/common';
import { MatchStatus, Prisma } from '@prisma/client';
import type { HomeFeedDto, listMatchesQuerySchema, MatchDetailDto, MatchSummaryDto, PageDto, SportDto } from '@dream11/shared';
import type { z } from 'zod';
import { Env, InjectEnv } from '../config/config.module';
import { paidContestsEnabled } from '../config/env';
import { openContestCounts } from '../contests/contest-counts';
import { PrismaService } from '../prisma/prisma.service';
import { matchSummaryInclude, toMatchDetail, toMatchSummary } from './match.mapper';

type ListQuery = z.output<typeof listMatchesQuerySchema>;

const ORDER: Record<MatchStatus, Prisma.MatchOrderByWithRelationInput[]> = {
  UPCOMING: [{ startTime: 'asc' }, { id: 'asc' }],
  LIVE: [{ startTime: 'asc' }, { id: 'asc' }],
  COMPLETED: [{ startTime: 'desc' }, { id: 'desc' }],
  ABANDONED: [{ startTime: 'desc' }, { id: 'desc' }],
};

const HOME_UPCOMING_LIMIT = 15;
const HOME_COMPLETED_LIMIT = 6;

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async sports(): Promise<SportDto[]> {
    const rows = await this.prisma.sport.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map(({ id, key, name, enabled }) => ({ id, key, name, enabled }));
  }

  /** Everything the home screen needs for one sport in a single round trip. */
  async homeFeed(sportKey: string): Promise<HomeFeedDto> {
    const sport = { key: sportKey, enabled: true };
    const [live, upcoming, completed] = await Promise.all([
      this.prisma.match.findMany({ where: { sport, status: 'LIVE' }, orderBy: ORDER.LIVE, include: matchSummaryInclude }),
      this.prisma.match.findMany({
        where: { sport, status: 'UPCOMING', startTime: { gt: new Date() } },
        orderBy: ORDER.UPCOMING,
        take: HOME_UPCOMING_LIMIT,
        include: matchSummaryInclude,
      }),
      this.prisma.match.findMany({
        where: { sport, status: { in: ['COMPLETED', 'ABANDONED'] } },
        orderBy: ORDER.COMPLETED,
        take: HOME_COMPLETED_LIMIT,
        include: matchSummaryInclude,
      }),
    ]);
    const counts = await this.contestCounts([...live, ...upcoming, ...completed].map((m) => m.id));
    const map = (rows: typeof live) => rows.map((m) => toMatchSummary(m, counts.get(m.id) ?? 0));
    return { live: map(live), upcoming: map(upcoming), completed: map(completed) };
  }

  async list(q: ListQuery): Promise<PageDto<MatchSummaryDto>> {
    const status = q.status ?? 'UPCOMING';
    const rows = await this.prisma.match.findMany({
      where: { sport: { key: q.sport, enabled: true }, status },
      orderBy: ORDER[status],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: matchSummaryInclude,
    });
    const page = rows.slice(0, q.limit);
    const counts = await this.contestCounts(page.map((m) => m.id));
    return {
      items: page.map((m) => toMatchSummary(m, counts.get(m.id) ?? 0)),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
    };
  }

  async detail(id: string): Promise<MatchDetailDto> {
    const match = await this.prisma.match.findFirst({
      where: { id, sport: { enabled: true } },
      include: { ...matchSummaryInclude, squad: { include: { player: true } } },
    });
    if (!match) throw new NotFoundException('Match not found');
    const counts = await this.contestCounts([match.id]);
    return toMatchDetail(match, counts.get(match.id) ?? 0);
  }

  private contestCounts(matchIds: string[]): Promise<Map<string, number>> {
    return openContestCounts(this.prisma, matchIds, paidContestsEnabled(this.env));
  }
}
