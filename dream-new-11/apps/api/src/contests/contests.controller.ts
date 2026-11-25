import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createPrivateContestSchema, inviteCodeSchema, joinContestSchema, myMatchesQuerySchema, switchTeamSchema } from '@dream11/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody, zodQuery, ZodValidationPipe } from '../common/zod-validation.pipe';
import { ContestsService } from './contests.service';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@Controller()
export class ContestsController {
  constructor(private readonly contests: ContestsService) {}

  @Get('matches/:id/contests')
  list(@CurrentUser() user: AuthUser, @Param('id') matchId: string) {
    return this.contests.listForMatch(user.id, matchId);
  }

  @Get('contests/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contests.detail(user.id, id);
  }

  @Post('contests/:id/join')
  @Throttle(WRITE_LIMIT)
  join(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(joinContestSchema)) body: z.output<typeof joinContestSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.contests.join(user.id, id, body, meta);
  }

  @Put('contests/:id/entries/:entryId')
  @Throttle(WRITE_LIMIT)
  switchTeam(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body(zodBody(switchTeamSchema)) body: z.output<typeof switchTeamSchema>,
  ) {
    return this.contests.switchTeam(user.id, id, entryId, body);
  }

  @Post('contests/private')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createPrivate(@CurrentUser() user: AuthUser, @Body(zodBody(createPrivateContestSchema)) body: z.output<typeof createPrivateContestSchema>, @Meta() meta: RequestMeta) {
    return this.contests.createPrivate(user.id, body, meta);
  }

  /** Tight limit so invite codes can't be brute-forced. */
  @Get('contests/invite/:code')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  lookup(@CurrentUser() user: AuthUser, @Param('code', new ZodValidationPipe(inviteCodeSchema)) code: string) {
    return this.contests.lookupInvite(user.id, code);
  }

  @Get('me/matches')
  myMatches(@CurrentUser() user: AuthUser, @Query(zodQuery(myMatchesQuerySchema)) q: z.output<typeof myMatchesQuerySchema>) {
    return this.contests.myMatches(user.id, q.status);
  }
}
