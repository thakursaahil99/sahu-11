import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppConfigDto, MIN_AGE, OTP_LENGTH } from '@dream11/shared';
import { Public } from './auth/jwt-auth.guard';
import { Env, InjectEnv } from './config/config.module';
import { paidContestsEnabled } from './config/env';
import { PrismaService } from './prisma/prisma.service';

@Public()
@SkipThrottle()
@Controller()
export class AppController {
  constructor(
    @InjectEnv() private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  /** Public runtime configuration the apps need before login. */
  @Get('config')
  config(): AppConfigDto {
    return {
      appMode: this.env.APP_MODE,
      paidContestsEnabled: paidContestsEnabled(this.env),
      minAge: MIN_AGE,
      otpLength: OTP_LENGTH,
      supportEmail: this.env.SUPPORT_EMAIL,
      termsUrl: this.env.TERMS_URL,
      privacyUrl: this.env.PRIVACY_URL,
      downloadPageUrl: `${this.env.PUBLIC_API_URL ?? `http://localhost:${this.env.PORT}`}/download`,
      // "log" still collects Expo tokens so delivery can be switched on without an app update.
      pushProvider: this.env.PUSH_PROVIDER === 'fcm' ? 'fcm' : 'expo',
    };
  }

  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', mode: this.env.APP_MODE, time: new Date().toISOString() };
  }
}
