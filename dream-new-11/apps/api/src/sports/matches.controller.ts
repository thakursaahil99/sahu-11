import { Controller, Get, Param, Query } from '@nestjs/common';
import { homeFeedQuerySchema, listMatchesQuerySchema } from '@dream11/shared';
import type { z } from 'zod';
import { zodQuery } from '../common/zod-validation.pipe';
import { MatchesService } from './matches.service';

@Controller()
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get('sports')
  sports() {
    return this.matches.sports();
  }

  /** Live, upcoming and recent matches for the home screen. */
  @Get('matches/feed')
  feed(@Query(zodQuery(homeFeedQuerySchema)) q: z.output<typeof homeFeedQuerySchema>) {
    return this.matches.homeFeed(q.sport);
  }

  @Get('matches')
  list(@Query(zodQuery(listMatchesQuerySchema)) q: z.output<typeof listMatchesQuerySchema>) {
    return this.matches.list(q);
  }

  @Get('matches/:id')
  detail(@Param('id') id: string) {
    return this.matches.detail(id);
  }
}
