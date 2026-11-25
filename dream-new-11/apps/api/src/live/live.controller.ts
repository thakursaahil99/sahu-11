import { Controller, Get, Param } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { LiveQueryService } from './live-query.service';

@Controller()
export class LiveController {
  constructor(private readonly live: LiveQueryService) {}

  /** Scorecard, every player's points and the caller's team totals. */
  @Get('matches/:id/live')
  matchLive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.live.matchLive(user.id, id);
  }

  /** Points breakdown for one team in a contest. */
  @Get('contests/:id/entries/:entryId')
  entry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('entryId') entryId: string) {
    return this.live.entryTeam(user.id, id, entryId);
  }
}
