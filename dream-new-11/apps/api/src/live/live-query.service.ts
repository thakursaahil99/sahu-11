import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EntryTeamDto, InningsDto, LiveScoreDto, MatchLiveDto, PlayerPointsDto, ScoreLine } from '@dream11/shared';
import { Env, InjectEnv } from '../config/config.module';
import { paidContestsEnabled } from '../config/env';
import { openContestCounts } from '../contests/contest-counts';
import { PrismaService } from '../prisma/prisma.service';
import { matchSummaryInclude, toMatchSummary } from '../sports/match.mapper';
import { FantasyConfigService } from '../teams/fantasy-config.service';

/** Read models for the live centre: scorecard, player points, and per-entry breakdowns. */
@Injectable()
export class LiveQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fantasy: FantasyConfigService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async matchLive(userId: string, matchId: string): Promise<MatchLiveDto> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, sport: { enabled: true } },
      include: { ...matchSummaryInclude, liveState: true },
    });
    if (!match) throw new NotFoundException('Match not found');

    const [players, myTeams, counts] = await Promise.all([
      this.playerPoints(matchId),
      this.prisma.userTeam.findMany({ where: { userId, matchId }, orderBy: { teamNumber: 'asc' }, select: { id: true, teamNumber: true, pointsX10: true } }),
      openContestCounts(this.prisma, [matchId], paidContestsEnabled(this.env)),
    ]);
    return {
      match: toMatchSummary(match, counts.get(matchId) ?? 0),
      score: toScore(match.liveState),
      players: [...players.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
      myTeams: myTeams.map((t) => ({ teamId: t.id, name: `T${t.teamNumber}`, points: t.pointsX10 / 10 })),
    };
  }

  /** One contest entry's team with each player's points. Others' teams unlock at the deadline. */
  async entryTeam(userId: string, contestId: string, entryId: string): Promise<EntryTeamDto> {
    const entry = await this.prisma.contestEntry.findFirst({
      where: { id: entryId, contestId },
      include: {
        user: { select: { name: true } },
        contest: { select: { type: true, createdById: true, match: { include: matchSummaryInclude } } },
        team: { include: { players: { include: { player: true } } } },
      },
    });
    if (!entry) throw new NotFoundException('Team not found');
    const isMe = entry.userId === userId;
    const match = entry.contest.match;

    if (!isMe) {
      if (match.status === 'UPCOMING') throw new ForbiddenException('Other teams are revealed when the match starts');
      if (entry.contest.type === 'PRIVATE' && entry.contest.createdById !== userId) {
        const member = await this.prisma.contestEntry.count({ where: { contestId, userId } });
        if (!member) throw new NotFoundException('Team not found');
      }
    }

    const [points, cfg] = await Promise.all([this.playerPoints(match.id), this.fantasy.forSport(match.sportId)]);
    const t = entry.team;
    const players = t.players.map((tp) => {
      const base = points.get(tp.playerId) ?? blank(tp.player, tp.sideTeamId, tp.role);
      const multiplier = tp.playerId === t.captainId ? cfg.captainMultiplier : tp.playerId === t.viceCaptainId ? cfg.viceCaptainMultiplier : 1;
      return { ...base, credits: tp.creditsX10 / 10, multiplier, total: Math.round(base.points * multiplier * 10) / 10 };
    });
    players.sort((a, b) => b.total - a.total);

    return {
      entryId: entry.id,
      contestId,
      userName: entry.user.name,
      isMe,
      teamName: `T${t.teamNumber}`,
      points: entry.pointsX10 / 10,
      rank: entry.rank,
      winnings: entry.winningsX100 / 100,
      captainId: t.captainId,
      viceCaptainId: t.viceCaptainId,
      players,
      match: toMatchSummary(match, 0),
    };
  }

  /** Base points per player for the whole squad (players without stats score 0). */
  private async playerPoints(matchId: string): Promise<Map<string, PlayerPointsDto>> {
    const [squad, points, teams] = await Promise.all([
      this.prisma.matchPlayer.findMany({ where: { matchId }, include: { player: true } }),
      this.prisma.playerMatchPoints.findMany({ where: { matchId } }),
      this.prisma.userTeam.count({ where: { matchId } }),
    ]);
    const picks = teams
      ? await this.prisma.$queryRaw<{ playerId: string; n: number }[]>(Prisma.sql`
          SELECT utp."playerId", count(*)::int AS n FROM "UserTeamPlayer" utp
          JOIN "UserTeam" ut ON ut.id = utp."teamId" WHERE ut."matchId" = ${matchId} GROUP BY utp."playerId"`)
      : [];
    const sel = new Map(picks.map((p) => [p.playerId, Math.round((p.n / teams) * 1000) / 10]));
    const pts = new Map(points.map((p) => [p.playerId, p]));

    return new Map(
      squad.map((mp) => {
        const row = pts.get(mp.playerId);
        return [
          mp.playerId,
          {
            playerId: mp.playerId,
            name: mp.player.name,
            shortName: mp.player.shortName,
            role: mp.role,
            teamId: mp.teamId,
            imageUrl: mp.player.imageUrl,
            isPlaying: mp.isPlaying,
            points: row ? row.pointsX10 / 10 : 0,
            lines: row ? (row.breakdown as unknown as ScoreLine[]) : [],
            selectedBy: sel.get(mp.playerId) ?? 0,
          },
        ];
      }),
    );
  }
}

function toScore(row: { state: Prisma.JsonValue; final: boolean; updatedAt: Date } | null): LiveScoreDto | null {
  if (!row) return null;
  const state = row.state as unknown as { innings: InningsDto[]; recentBalls: string[] };
  return { innings: state.innings, recentBalls: state.recentBalls, final: row.final, updatedAt: row.updatedAt.toISOString() };
}

/** A squad player missing from the squad snapshot (e.g. squad re-synced after the team was saved). */
function blank(player: { id: string; name: string; shortName: string; imageUrl: string | null }, teamId: string, role: PlayerPointsDto['role']): PlayerPointsDto {
  return { playerId: player.id, name: player.name, shortName: player.shortName, role, teamId, imageUrl: player.imageUrl, isPlaying: null, points: 0, lines: [], selectedBy: 0 };
}
