import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordSchema,
  loginEmailSchema,
  refreshTokenSchema,
  registerEmailSchema,
  registerPhoneSchema,
  requestOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from '@dream11/shared';
import type { z } from 'zod';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public } from './jwt-auth.guard';

/** Tight limits on credential endpoints: 5 requests/minute per IP. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body(zodBody(requestOtpSchema)) body: z.output<typeof requestOtpSchema>, @Meta() meta: RequestMeta) {
    return this.auth.requestOtp(body.phone, meta);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body(zodBody(verifyOtpSchema)) body: z.output<typeof verifyOtpSchema>, @Meta() meta: RequestMeta) {
    return this.auth.verifyOtp(body.phone, body.code, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('register/phone')
  registerPhone(@Body(zodBody(registerPhoneSchema)) body: z.output<typeof registerPhoneSchema>, @Meta() meta: RequestMeta) {
    return this.auth.registerWithPhone(body, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('register/email')
  registerEmail(@Body(zodBody(registerEmailSchema)) body: z.output<typeof registerEmailSchema>, @Meta() meta: RequestMeta) {
    return this.auth.registerWithEmail(body, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login/email')
  @HttpCode(200)
  loginEmail(@Body(zodBody(loginEmailSchema)) body: z.output<typeof loginEmailSchema>, @Meta() meta: RequestMeta) {
    return this.auth.loginWithEmail(body, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/forgot')
  @HttpCode(200)
  forgot(@Body(zodBody(forgotPasswordSchema)) body: z.output<typeof forgotPasswordSchema>, @Meta() meta: RequestMeta) {
    return this.auth.forgotPassword(body, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/reset')
  @HttpCode(200)
  reset(@Body(zodBody(resetPasswordSchema)) body: z.output<typeof resetPasswordSchema>, @Meta() meta: RequestMeta) {
    return this.auth.resetPassword(body, meta);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(zodBody(refreshTokenSchema)) body: z.output<typeof refreshTokenSchema>, @Meta() meta: RequestMeta) {
    return this.auth.refresh(body.refreshToken, meta);
  }

  /** Public so an expired access token never blocks logout; the refresh token is what gets revoked. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(zodBody(refreshTokenSchema)) body: z.output<typeof refreshTokenSchema>, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.logout(body.refreshToken, meta);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.logoutAll(user.id, meta);
  }
}
