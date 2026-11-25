import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createTicketSchema, ticketReplySchema } from '@dream11/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody } from '../common/zod-validation.pipe';
import { SupportService } from './support.service';

@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.support.list(user.id);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.detail(user.id, id);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  create(@CurrentUser() user: AuthUser, @Body(zodBody(createTicketSchema)) body: z.output<typeof createTicketSchema>, @Meta() meta: RequestMeta) {
    return this.support.create(user.id, body, meta);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(zodBody(ticketReplySchema)) body: z.output<typeof ticketReplySchema>) {
    return this.support.reply(user.id, id, body);
  }
}

@Module({
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
