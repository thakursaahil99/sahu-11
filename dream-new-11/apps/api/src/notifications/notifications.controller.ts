import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { markReadSchema, notificationsQuerySchema, pushTokenSchema } from '@dream11/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

const removeTokenSchema = z.object({ token: z.string().min(10).max(400) });

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthUser, @Query(zodQuery(notificationsQuerySchema)) q: z.output<typeof notificationsQuerySchema>) {
    return this.notifications.list(user.id, q.limit, q.cursor);
  }

  @Get('notifications/unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Post('notifications/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Body(zodBody(markReadSchema)) body: z.output<typeof markReadSchema>) {
    return this.notifications.markRead(user.id, body);
  }

  @Post('me/push-tokens')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(@CurrentUser() user: AuthUser, @Body(zodBody(pushTokenSchema)) body: z.output<typeof pushTokenSchema>) {
    await this.notifications.registerToken(user.id, body);
  }

  @Delete('me/push-tokens')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Body(zodBody(removeTokenSchema)) body: z.output<typeof removeTokenSchema>) {
    await this.notifications.removeToken(user.id, body.token);
  }
}
