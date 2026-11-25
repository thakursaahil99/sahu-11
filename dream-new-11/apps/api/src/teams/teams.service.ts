import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  createTeamSchema,
  MyTeamsGroupDto,
  PickablePlayer,
  PlayerSelectionDto,
  TeamBuilderDto,
  teamSignature,
  TeamWithMatchDto,
  updateTeamSchema,
  UserTeamDto,
  validateTeam,
} from '@dream11/shared';
import type { z } from 'zod';
import { Env, InjectEnv } from '../config/config.module';
import { ResponsiblePlayService } from '../responsible-play/responsible-play.service';
import { paidContestsEnabled } from '../config/env';
import { openContestCounts } from '../contests/contest-counts';
import { PrismaService } from '../prisma/prisma.service';
import { matchSummaryInclude, toMatchSummary } from '../sports/match.mapper';
import { MatchesService } from '../sports/matches.service';
import { FantasyConfigService } from './fantasy-config.service';
import { teamInclude, toUserTeamDto } from './team.mapper';

type CreateTeam = z.output<typeof createTeamSchema>;
type UpdateTeam = z.output<typeof updateTeamSchema>;

const STATUS_ORDER = { UPCOMING: 0, LIVE: 1, COMPLETED: 2, ABANDONED: 3 } as const;

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly config: FantasyConfigService,
    private readonly play: ResponsiblePlayService,
    @InjectEnv() private readonly env: Env,
  ) {}

  /** Match + squad, rules, selection %, and this user's teams — everything the builder renders. */
  async builder(userId: string, matchId: string): Promise<TeamBuilderDto> {
    const match = await this.matches.detail(matchId);
    const sportId = (await this.prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { sportId: true } })).sportId;
    const [rules, selection, myTeams] = await Promise.all([
      this.config.forSport(sportId),
      this.selection(matchId),
      this.teamsForMatch(userId, matchId),
    ]);
    return { match, rules, selection, myTeams, editable: isEditable(match.status, new Date(match.startTime)) };
  }

  async listForMatch(userId: string, matchId: string): Promise<UserTeamDto[]> {
    return this.teamsForMatch(userId, matchId);
  }

  /** All of the user's teams, grouped by match: upcoming soonest first, then live, then finished. */
  async listAll(userId: string): Promise<MyTeamsGroupDto[]> {
    const teams = await this.prisma.userTeam.findMany({
      where: { userId },
      include: { ...teamInclude, match: { include: matchSummaryInclude } },
      orderBy: [{ match: { startTime: 'asc' } }, { teamNumber: 'asc' }],
      take: 200,
    });
    const matchIds = [...new Set(teams.map((t) => t.matchId))];
    const [playing, counts] = await Promise.all([this.lineups(matchIds), openContestCounts(this.prisma, matchIds, paidContestsEnabled(this.env))]);
    const groups = new Map<string, MyTeamsGroupDto>();
    for (const t of teams) {
      const group = groups.get(t.matchId) ?? { match: toMatchSummary(t.match, counts.get(t.matchId) ?? 0), teams: [] };
      group.teams.push(toUserTeamDto(t, playing));
      groups.set(t.matchId, group);
    }
    return [...groups.values()].sort((a, b) => {
      const s = STATUS_ORDER[a.match.status] - STATUS_ORDER[b.match.status];
      if (s !== 0) return s;
      const ta = Date.parse(a.match.startTime);
      const tb = Date.parse(b.match.startTime);
      return a.match.status === 'UPCOMING' ? ta - tb : tb - ta;
    });
  }

  async get(userId: string, teamId: string): Promise<TeamWithMatchDto> {
    const team = await this.prisma.userTeam.findFirst({
      where: { id: teamId, userId },
      include: { ...teamInclude, match: { include: matchSummaryInclude } },
    });
    if (!team) throw new NotFoundException('Team not found');
    const [playing, counts] = await Promise.all([this.lineups([team.matchId]), openContestCounts(this.prisma, [team.matchId], paidContestsEnabled(this.env))]);
    return {
      ...toUserTeamDto(team, playing),
      match: toMatchSummary(team.match, counts.get(team.matchId) ?? 0),
      editable: isEditable(team.match.status, team.match.startTime),
    };
  }

  async create(userId: string, input: CreateTeam): Promise<UserTeamDto> {
    await this.play.assertCanPlay(userId);
    return this.save(userId, input.matchId, input, null);
  }

  async update(userId: string, teamId: string, input: UpdateTeam): Promise<UserTeamDto> {
    const team = await this.prisma.userTeam.findFirst({ where: { id: teamId, userId }, select: { matchId: true } });
    if (!team) throw new NotFoundException('Team not found');
    return this.save(userId, team.matchId, input, teamId);
  }

  /** Server-side source of truth: every rule is re-checked here, regardless of what the app sent. */
  private async save(userId: string, matchId: string, input: UpdateTeam, teamId: string | null): Promise<UserTeamDto> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, sport: { enabled: true } },
      select: { id: true, sportId: true, status: true, startTime: true },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (!isEditable(match.status, match.startTime)) {
      throw new ForbiddenException('The deadline for this match has passed. Teams are locked.');
    }

    const squad = await this.prisma.matchPlayer.findMany({ where: { matchId, playerId: { in: input.playerIds } } });
    const byId = new Map(squad.map((mp) => [mp.playerId, mp]));
    const missing = input.playerIds.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new BadRequestException({ message: 'Some players are not in this match squad', fields: { playerIds: 'Unknown player' } });

    const players: PickablePlayer[] = input.playerIds.map((id) => {
      const mp = byId.get(id)!;
      return { id, role: mp.role, credits: mp.creditsX10 / 10, teamId: mp.teamId };
    });
    const rules = await this.config.forSport(match.sportId);
    const errors = validateTeam({ players, captainId: input.captainId, viceCaptainId: input.viceCaptainId }, rules);
    if (errors.length > 0) {
      throw new BadRequestException({
        message: errors[0]!.message,
        fields: Object.fromEntries(errors.map((e) => [e.code, e.message])),
      });
    }

    const signature = teamSignature(input.playerIds, input.captainId, input.viceCaptainId);
    const creditsX10 = players.reduce((sum, p) => sum + Math.round(p.credits * 10), 0);
    const rows = input.playerIds.map((playerId) => {
      const mp = byId.get(playerId)!;
      return { playerId, sideTeamId: mp.teamId, role: mp.role, creditsX10: mp.creditsX10 };
    });

    const saved = await this.prisma.$transaction(async (tx) => {
      // Serialise saves per user+match so two parallel requests can't both pass the team-limit check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${matchId}`}))`;
      const existing = await tx.userTeam.findMany({ where: { userId, matchId }, select: { id: true, teamNumber: true, signature: true } });

      const twin = existing.find((t) => t.signature === signature && t.id !== teamId);
      if (twin) throw new ConflictException(`You already have this exact team as T${twin.teamNumber}`);

      if (teamId) {
        await tx.userTeamPlayer.deleteMany({ where: { teamId } });
        return tx.userTeam.update({
          where: { id: teamId },
          data: { captainId: input.captainId, viceCaptainId: input.viceCaptainId, creditsX10, signature, players: { create: rows } },
          include: teamInclude,
        });
      }

      if (existing.length >= rules.maxTeamsPerMatch) {
        throw new ConflictException(`You can create up to ${rules.maxTeamsPerMatch} teams per match`);
      }
      const used = new Set(existing.map((t) => t.teamNumber));
      let teamNumber = 1;
      while (used.has(teamNumber)) teamNumber++;
      return tx.userTeam.create({
        data: { userId, matchId, teamNumber, captainId: input.captainId, viceCaptainId: input.viceCaptainId, creditsX10, signature, players: { create: rows } },
        include: teamInclude,
      });
    });

    return toUserTeamDto(saved, await this.lineups([matchId]));
  }

  private async teamsForMatch(userId: string, matchId: string): Promise<UserTeamDto[]> {
    const teams = await this.prisma.userTeam.findMany({ where: { userId, matchId }, include: teamInclude, orderBy: { teamNumber: 'asc' } });
    const playing = await this.lineups([matchId]);
    return teams.map((t) => toUserTeamDto(t, playing));
  }

  /** Current isPlaying flags for the given matches' squads. */
  private async lineups(matchIds: string[]): Promise<Map<string, boolean | null>> {
    if (matchIds.length === 0) return new Map();
    const rows = await this.prisma.matchPlayer.findMany({
      where: { matchId: { in: matchIds } },
      select: { playerId: true, isPlaying: true },
    });
    return new Map(rows.map((r) => [r.playerId, r.isPlaying]));
  }

  /** "Selected by" percentages across every team created for the match. */
  private async selection(matchId: string): Promise<Record<string, PlayerSelectionDto>> {
    const [total, picks, captains, vices] = await Promise.all([
      this.prisma.userTeam.count({ where: { matchId } }),
      this.prisma.$queryRaw<{ playerId: string; n: number }[]>(Prisma.sql`
        SELECT utp."playerId", count(*)::int AS n
        FROM "UserTeamPlayer" utp JOIN "UserTeam" ut ON ut.id = utp."teamId"
        WHERE ut."matchId" = ${matchId}
        GROUP BY utp."playerId"`),
      this.prisma.userTeam.groupBy({ by: ['captainId'], where: { matchId }, _count: { _all: true } }),
      this.prisma.userTeam.groupBy({ by: ['viceCaptainId'], where: { matchId }, _count: { _all: true } }),
    ]);
    if (total === 0) return {};
    const pct = (n: number) => Math.round((n / total) * 1000) / 10;
    const out: Record<string, PlayerSelectionDto> = {};
    const entry = (id: string) => (out[id] ??= { selectedBy: 0, captainBy: 0, viceCaptainBy: 0 });
    for (const r of picks) entry(r.playerId).selectedBy = pct(r.n);
    for (const r of captains) entry(r.captainId).captainBy = pct(r._count._all);
    for (const r of vices) entry(r.viceCaptainId).viceCaptainBy = pct(r._count._all);
    return out;
  }
}

/** Teams can be created and edited until the scheduled start. */
function isEditable(status: string, startTime: Date): boolean {
  return status === 'UPCOMING' && startTime.getTime() > Date.now();
}
