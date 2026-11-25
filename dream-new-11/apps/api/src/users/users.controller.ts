import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { deleteAccountSchema, myContestsQuerySchema, updateProfileSchema, updateSettingsSchema } from '@dream11/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { HistoryService } from './history.service';
import { AVATAR_MAX_BYTES, UsersService } from './users.service';

@Controller('me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly history: HistoryService,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(updateProfileSchema)) body: z.output<typeof updateProfileSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.users.updateProfile(user.id, body, meta);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body(zodBody(updateSettingsSchema)) body: z.output<typeof updateSettingsSchema>) {
    return this.users.updateSettings(user.id, body);
  }

  @Post('avatar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('avatar', { storage: memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }))
  uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Meta() meta: RequestMeta) {
    return this.users.setAvatar(user.id, file, meta);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.users.removeAvatar(user.id);
  }

  @Get('contests')
  contests(@CurrentUser() user: AuthUser, @Query(zodQuery(myContestsQuerySchema)) q: z.output<typeof myContestsQuerySchema>) {
    return this.history.contests(user.id, q.limit, q.cursor);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.history.stats(user.id);
  }

  /** Permanently anonymises the account (see UsersService.deleteAccount). */
  @Delete()
  @HttpCode(204)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async remove(@CurrentUser() user: AuthUser, @Body(zodBody(deleteAccountSchema)) _body: z.output<typeof deleteAccountSchema>, @Meta() meta: RequestMeta) {
    await this.users.deleteAccount(user.id, meta);
  }
}
