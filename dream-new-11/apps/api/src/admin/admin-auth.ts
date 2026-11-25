import { Body, ConflictException, Get, HttpCode, Injectable, Post, UnauthorizedException, BadRequestException, Controller, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { adminLoginSchema, isStaff, mfaEnableSchema, mfaVerifySchema, reauthSchema, ROLE_PERMISSIONS, type AdminLoginResult, type AdminMe, type AdminSession, type StaffRole } from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Public } from '../auth/jwt-auth.guard';
import { TokenService } from '../auth/token.service';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody } from '../common/zod-validation.pipe';
import { Env, InjectEnv } from '../config/config.module';
import { adminMfaRequired } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AdminGuard, AllowWithoutMfa, type ReauthPayload } from './admin.guard';
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUrl, verifyTotp } from './totp';

const CHALLENGE_TTL = 300;
const REAUTH_TTL = 300;
// Same cost as real hashes so unknown emails take as long as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('dream-new-11-admin-timing-equaliser', 12);

interface MfaChallenge {
  sub: string;
  typ: 'mfa';
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<AdminLoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.passwordHash || !isStaff(user.role) || user.status === 'SUSPENDED' || user.status === 'DELETED') {
      await this.audit.log({ action: 'admin.login_failed', actorId: user?.id, metadata: { email }, meta });
      // Same message for "not staff" so the panel doesn't reveal who is an admin.
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.mfaEnabledAt) {
      const challenge = await this.jwt.signAsync({ sub: user.id, typ: 'mfa' } satisfies MfaChallenge, { secret: this.env.JWT_ACCESS_SECRET, expiresIn: CHALLENGE_TTL });
      return { mfaRequired: true, challenge };
    }
    await this.audit.log({ action: 'admin.login', actorId: user.id, metadata: { mfa: false }, meta });
    return { mfaRequired: false, ...(await this.session(user, false, meta)) };
  }

  async verifyMfa(challenge: string, code: string, meta: RequestMeta): Promise<AdminSession> {
    let sub: string;
    try {
      const p = await this.jwt.verifyAsync<MfaChallenge>(challenge, { secret: this.env.JWT_ACCESS_SECRET });
      if (p.typ !== 'mfa') throw new Error('wrong token');
      sub = p.sub;
    } catch {
      throw new UnauthorizedException('Sign-in expired. Please start again.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user || !isStaff(user.role)) throw new UnauthorizedException('Sign-in expired. Please start again.');
    await this.checkCode(user, code, meta);
    await this.audit.log({ action: 'admin.login', actorId: user.id, metadata: { mfa: true }, meta });
    return this.session(user, true, meta);
  }

  async me(auth: AuthUser): Promise<AdminMe> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
    return this.toMe(user, auth.mfa);
  }

  /** Starts (or restarts) enrolment: a new secret, not active until a code confirms it. */
  async setupMfa(auth: AuthUser): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
    if (user.mfaEnabledAt) throw new ConflictException('Two-factor authentication is already on');
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(secret, this.env.OTP_SECRET), mfaLastStep: null } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email ?? user.id) };
  }

  /** Confirms enrolment and upgrades to a 2FA-verified session; other sessions are signed out. */
  async enableMfa(auth: AuthUser, code: string, meta: RequestMeta): Promise<AdminSession> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
    if (user.mfaEnabledAt) throw new ConflictException('Two-factor authentication is already on');
    if (!user.mfaSecret) throw new BadRequestException('Start the setup first');
    await this.checkCode(user, code, meta);
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date() } });
    await this.tokens.revokeAllForUser(user.id);
    await this.audit.log({ action: 'admin.mfa_enabled', actorId: user.id, meta });
    return this.session(updated, true, meta);
  }

  /** Step-up for sensitive actions: the 2FA code if enabled, otherwise the password. */
  async reauth(auth: AuthUser, input: z.output<typeof reauthSchema>, meta: RequestMeta): Promise<{ reauthToken: string; expiresIn: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
    if (user.mfaEnabledAt) {
      if (!input.code) throw new BadRequestException({ message: 'Enter the code from your authenticator app', fields: { code: 'Required' } });
      await this.checkCode(user, input.code, meta);
    } else if (!input.password || !user.passwordHash || !(await bcrypt.compare(input.password, user.passwordHash))) {
      await this.audit.log({ action: 'admin.reauth_failed', actorId: user.id, meta });
      throw new UnauthorizedException({ message: 'Wrong password', fields: { password: 'Wrong password' } });
    }
    const reauthToken = await this.jwt.signAsync({ sub: user.id, typ: 'reauth' } satisfies ReauthPayload, { secret: this.env.JWT_ACCESS_SECRET, expiresIn: REAUTH_TTL });
    return { reauthToken, expiresIn: REAUTH_TTL };
  }

  private async checkCode(user: User, code: string, meta: RequestMeta): Promise<void> {
    const step = user.mfaSecret ? verifyTotp(decryptSecret(user.mfaSecret, this.env.OTP_SECRET), code) : null;
    // Each code works once: a step at or before the last accepted one is a replay.
    if (step === null || (user.mfaLastStep !== null && step <= user.mfaLastStep)) {
      await this.audit.log({ action: 'admin.mfa_failed', actorId: user.id, meta });
      throw new UnauthorizedException({ message: 'That code didn’t work. Wait for a new one and try again.', fields: { code: 'Invalid code' } });
    }
    const { count } = await this.prisma.user.updateMany({ where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } });
    if (!count) throw new UnauthorizedException({ message: 'That code was already used', fields: { code: 'Already used' } });
  }

  private async session(user: User, mfa: boolean, meta: RequestMeta): Promise<AdminSession> {
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { me: this.toMe(user, mfa), tokens: await this.tokens.issue(user, meta, undefined, { scope: 'admin', mfa }) };
  }

  private toMe(user: User, mfaVerified: boolean): AdminMe {
    const role = user.role as StaffRole;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      permissions: [...(ROLE_PERMISSIONS[role] ?? [])],
      mfaEnabled: !!user.mfaEnabledAt,
      mfaVerified,
      mfaRequired: adminMfaRequired(this.env),
    };
  }
}

const LOGIN_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  login(@Body(zodBody(adminLoginSchema)) body: z.output<typeof adminLoginSchema>, @Meta() meta: RequestMeta) {
    return this.auth.login(body.email, body.password, meta);
  }

  @Public()
  @Post('mfa')
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  mfa(@Body(zodBody(mfaVerifySchema)) body: z.output<typeof mfaVerifySchema>, @Meta() meta: RequestMeta) {
    return this.auth.verifyMfa(body.challenge, body.code, meta);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  setup(@CurrentUser() user: AuthUser) {
    return this.auth.setupMfa(user);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @AllowWithoutMfa()
  @Throttle(LOGIN_LIMIT)
  enable(@CurrentUser() user: AuthUser, @Body(zodBody(mfaEnableSchema)) body: z.output<typeof mfaEnableSchema>, @Meta() meta: RequestMeta) {
    return this.auth.enableMfa(user, body.code, meta);
  }

  @Post('reauth')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Throttle(LOGIN_LIMIT)
  reauth(@CurrentUser() user: AuthUser, @Body(zodBody(reauthSchema)) body: z.output<typeof reauthSchema>, @Meta() meta: RequestMeta) {
    return this.auth.reauth(user, body, meta);
  }
}
