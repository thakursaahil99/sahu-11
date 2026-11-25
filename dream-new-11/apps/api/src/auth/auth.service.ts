import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma, User } from '@prisma/client';
import { DEMO_OTP, OTP_RESEND_SECONDS, OTP_TTL_SECONDS, isStaff } from '@dream11/shared';
import type {
  AuthResponse,
  OtpRequestResponse,
  VerifyOtpResponse,
  forgotPasswordSchema,
  loginEmailSchema,
  registerEmailSchema,
  registerPhoneSchema,
  resetPasswordSchema,
} from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { Env, InjectEnv } from '../config/config.module';
import { EMAIL_PROVIDER, EmailProvider, passwordResetEmail } from '../notify/email.provider';
import { SMS_PROVIDER, SmsProvider } from '../notify/sms.provider';
import { PrismaService } from '../prisma/prisma.service';
import { toUserDto, userInclude, UserWithSettings } from '../users/user.mapper';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

type RegisterPhone = z.output<typeof registerPhoneSchema>;
type RegisterEmail = z.output<typeof registerEmailSchema>;
type LoginEmail = z.output<typeof loginEmailSchema>;
type ForgotPassword = z.output<typeof forgotPasswordSchema>;
type ResetPassword = z.output<typeof resetPasswordSchema>;

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Precomputed hash so unknown-email logins take as long as real ones (no account enumeration by timing). */
const DUMMY_HASH = bcrypt.hashSync('dream-new-11-timing-equaliser', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @InjectEnv() private readonly env: Env,
  ) {}

  async requestOtp(phone: string, meta: RequestMeta): Promise<OtpRequestResponse> {
    const issued = await this.otp.issue(phone, 'LOGIN', 'SMS', meta.ip);
    await this.sms.sendOtp(phone, issued.code);
    return {
      resendIn: issued.resendIn,
      expiresIn: issued.expiresIn,
      ...(this.env.APP_MODE === 'demo' ? { demoCode: issued.code } : {}),
    };
  }

  async verifyOtp(phone: string, code: string, meta: RequestMeta): Promise<VerifyOtpResponse> {
    await this.otp.consume(phone, 'LOGIN', code);

    const existing = await this.prisma.user.findUnique({ where: { phone }, include: userInclude });
    if (!existing) {
      return { isNewUser: true, phone, signupToken: await this.tokens.signSignupToken(phone) };
    }

    this.assertCanLogin(existing);
    const user = await this.prisma.user.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date(), phoneVerifiedAt: existing.phoneVerifiedAt ?? new Date() },
      include: userInclude,
    });
    await this.audit.log({ action: 'auth.login', actorId: user.id, metadata: { method: 'otp' }, meta });
    return { isNewUser: false, ...(await this.session(user, meta)) };
  }

  async registerWithPhone(input: RegisterPhone, meta: RequestMeta): Promise<AuthResponse> {
    const phone = await this.tokens.verifySignupToken(input.signupToken);
    if (await this.prisma.user.findUnique({ where: { phone }, select: { id: true } })) {
      throw new ConflictException('This mobile number is already registered. Please log in.');
    }
    if (input.email) await this.assertEmailFree(input.email);

    const user = await this.createUser(
      {
        phone,
        phoneVerifiedAt: new Date(),
        email: input.email ?? null,
        name: input.name,
        dob: new Date(`${input.dob}T00:00:00.000Z`),
      },
      meta,
      'phone',
    );
    return this.session(user, meta);
  }

  async registerWithEmail(input: RegisterEmail, meta: RequestMeta): Promise<AuthResponse> {
    await this.assertEmailFree(input.email);
    const user = await this.createUser(
      {
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, this.env.BCRYPT_ROUNDS),
        name: input.name,
        dob: new Date(`${input.dob}T00:00:00.000Z`),
      },
      meta,
      'email',
    );
    return this.session(user, meta);
  }

  async loginWithEmail(input: LoginEmail, meta: RequestMeta): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email }, include: userInclude });
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !valid) {
      await this.audit.log({ action: 'auth.login_failed', actorId: user?.id, metadata: { method: 'email' }, meta });
      throw new UnauthorizedException('Invalid email or password');
    }
    this.assertCanLogin(user);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      include: userInclude,
    });
    await this.audit.log({ action: 'auth.login', actorId: user.id, metadata: { method: 'email' }, meta });
    return this.session(updated, meta);
  }

  /** Always answers the same way whether or not the email exists. */
  async forgotPassword(input: ForgotPassword, meta: RequestMeta): Promise<OtpRequestResponse & { message: string }> {
    const message = 'If an account exists for this email, a reset code has been sent.';
    const user = await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (user) {
      const issued = await this.otp.issue(input.email, 'RESET_PASSWORD', 'EMAIL', meta.ip);
      await this.email.send(passwordResetEmail(input.email, issued.code));
      await this.audit.log({ action: 'auth.password_reset_requested', actorId: user.id, meta });
    }
    return {
      message,
      resendIn: OTP_RESEND_SECONDS,
      expiresIn: OTP_TTL_SECONDS,
      ...(this.env.APP_MODE === 'demo' ? { demoCode: DEMO_OTP } : {}),
    };
  }

  async resetPassword(input: ResetPassword, meta: RequestMeta): Promise<{ message: string }> {
    await this.otp.consume(input.email, 'RESET_PASSWORD', input.code);
    const user = await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (!user) throw new UnauthorizedException('Invalid reset request');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(input.password, this.env.BCRYPT_ROUNDS), emailVerifiedAt: new Date() },
    });
    await this.tokens.revokeAllForUser(user.id);
    await this.audit.log({ action: 'auth.password_reset', actorId: user.id, meta });
    return { message: 'Password updated. Please log in with your new password.' };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResponse> {
    const { userId, familyId, scope, mfa } = await this.tokens.rotate(refreshToken, meta);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: userInclude });
    if (!user) throw new UnauthorizedException('Session expired. Please log in again.');
    this.assertCanLogin(user);
    // An admin session ends if the person is no longer staff.
    if (scope === 'admin' && !isStaff(user.role)) throw new UnauthorizedException('Session expired. Please log in again.');
    return { user: toUserDto(user), tokens: await this.tokens.issue(user, meta, familyId, { scope, mfa }) };
  }

  async logout(refreshToken: string, meta: RequestMeta): Promise<void> {
    const userId = await this.tokens.revoke(refreshToken);
    if (userId) await this.audit.log({ action: 'auth.logout', actorId: userId, meta });
  }

  async logoutAll(userId: string, meta: RequestMeta): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    await this.audit.log({ action: 'auth.logout_all', actorId: userId, meta });
  }

  private async session(user: UserWithSettings, meta: RequestMeta): Promise<AuthResponse> {
    return { user: toUserDto(user), tokens: await this.tokens.issue(user, meta) };
  }

  private assertCanLogin(user: Pick<User, 'status'>): void {
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Your account is suspended. Please contact support.');
    }
  }

  private async assertEmailFree(email: string): Promise<void> {
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException({ message: 'An account with this email already exists', fields: { email: 'Already registered' } });
    }
  }

  private async createUser(
    data: Omit<Prisma.UserCreateInput, 'referralCode' | 'termsAcceptedAt'>,
    meta: RequestMeta,
    method: 'phone' | 'email',
  ): Promise<UserWithSettings> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          ...data,
          referralCode: await this.uniqueReferralCode(tx),
          termsAcceptedAt: new Date(),
          lastLoginAt: new Date(),
          settings: { create: {} },
        },
        include: userInclude,
      });
      await this.audit.log({ action: 'auth.register', actorId: user.id, metadata: { method }, meta }, tx);
      return user;
    });
  }

  private async uniqueReferralCode(tx: Prisma.TransactionClient): Promise<string> {
    for (;;) {
      const bytes = randomBytes(6);
      const code = 'D11' + Array.from(bytes, (b) => REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length]).join('');
      if (!(await tx.user.findUnique({ where: { referralCode: code }, select: { id: true } }))) return code;
    }
  }
}
