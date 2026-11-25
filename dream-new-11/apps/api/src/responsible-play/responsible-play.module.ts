import { Body, Controller, Delete, Get, Global, HttpCode, Module, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { depositLimitsSchema, takeBreakSchema } from '@dream11/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody } from '../common/zod-validation.pipe';
import { ResponsiblePlayService } from './responsible-play.service';

@Controller('me/responsible-play')
export class ResponsiblePlayController {
  constructor(private readonly play: ResponsiblePlayService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.play.get(user.id);
  }

  @Put('limits')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  limits(@CurrentUser() user: AuthUser, @Body(zodBody(depositLimitsSchema)) body: z.output<typeof depositLimitsSchema>, @Meta() meta: RequestMeta) {
    return this.play.setLimits(user.id, body, meta);
  }

  @Delete('limits/pending')
  cancelPending(@CurrentUser() user: AuthUser) {
    return this.play.cancelPending(user.id);
  }

  @Post('break')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  takeBreak(@CurrentUser() user: AuthUser, @Body(zodBody(takeBreakSchema)) body: z.output<typeof takeBreakSchema>, @Meta() meta: RequestMeta) {
    return this.play.takeBreak(user.id, body.days, meta);
  }
}

/** Global: contests, teams and the wallet all ask "may this user play / deposit?". */
@Global()
@Module({
  controllers: [ResponsiblePlayController],
  providers: [ResponsiblePlayService],
  exports: [ResponsiblePlayService],
})
export class ResponsiblePlayModule {}
