import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createTeamSchema, listTeamsQuerySchema, sportKeySchema, updateTeamSchema } from '@dream11/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { FantasyConfigService } from './fantasy-config.service';
import { TeamsService } from './teams.service';

const rulesQuerySchema = z.object({ sport: sportKeySchema.default('cricket') });
const SAVE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@Controller()
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly config: FantasyConfigService,
  ) {}

  @Get('fantasy/rules')
  rules(@Query(zodQuery(rulesQuerySchema)) q: z.output<typeof rulesQuerySchema>) {
    return this.config.forSportKey(q.sport);
  }

  @Get('matches/:id/builder')
  builder(@CurrentUser() user: AuthUser, @Param('id') matchId: string) {
    return this.teams.builder(user.id, matchId);
  }

  /** With ?matchId: that match's teams. Without: every team grouped by match. */
  @Get('teams')
  list(@CurrentUser() user: AuthUser, @Query(zodQuery(listTeamsQuerySchema)) q: z.output<typeof listTeamsQuerySchema>) {
    return q.matchId ? this.teams.listForMatch(user.id, q.matchId) : this.teams.listAll(user.id);
  }

  @Get('teams/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.teams.get(user.id, id);
  }

  @Post('teams')
  @Throttle(SAVE_LIMIT)
  create(@CurrentUser() user: AuthUser, @Body(zodBody(createTeamSchema)) body: z.output<typeof createTeamSchema>) {
    return this.teams.create(user.id, body);
  }

  @Put('teams/:id')
  @Throttle(SAVE_LIMIT)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(zodBody(updateTeamSchema)) body: z.output<typeof updateTeamSchema>) {
    return this.teams.update(user.id, id, body);
  }
}
