import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { User } from '@prisma/client';
import type { AuthTokens } from '@dream11/shared';
import type { RequestMeta } from '../common/request-meta';
import { Env, InjectEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, SessionScope } from './jwt-auth.guard';

export interface SessionOptions {
  scope?: SessionScope;
  mfa?: boolean;
}

/** Admin-panel sessions end after 12 hours regardless of activity. */
const ADMIN_SESSION_MS = 12 * 3_600_000;

interface SignupTokenPayload {
  phone: string;
  typ: 'signup';
}

const SIGNUP_TOKEN_TTL_SECONDS = 15 * 60;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Access tokens are short-lived JWTs. Refresh tokens are opaque `<id>.<secret>` strings
 * stored as hashes and rotated on every use; replaying a rotated token revokes its family.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async issue(user: Pick<User, 'id' | 'role'>, meta: RequestMeta, familyId: string = randomUUID(), opts: SessionOptions = {}): Promise<AuthTokens> {
    const scope = opts.scope ?? 'app';
    const mfa = opts.mfa ?? false;
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, typ: 'access', ...(scope === 'admin' ? { scope, mfa } : {}) };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
    });
    const refreshToken = await this.createRefreshToken(user.id, familyId, meta, scope, mfa);
    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS };
  }

  /** Validates a refresh token and returns the owning user id plus a fresh token pair. */
  async rotate(raw: string, meta: RequestMeta): Promise<{ userId: string; familyId: string; scope: SessionScope; mfa: boolean; expiresAt: Date }> {
    const record = await this.find(raw);
    if (!record) throw new UnauthorizedException('Session expired. Please log in again.');

    if (record.revokedAt) {
      // A rotated token was presented again: assume theft and kill every session in the family.
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date(), ip: meta.ip, userAgent: meta.userAgent },
    });
    if (count === 0) {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    return { userId: record.userId, familyId: record.familyId, scope: record.scope as SessionScope, mfa: record.mfa, expiresAt: record.expiresAt };
  }

  /** Revokes the session the token belongs to; returns its user id, or null for an unknown token. */
  async revoke(raw: string): Promise<string | null> {
    const record = await this.find(raw);
    if (!record) return null;
    await this.revokeFamily(record.familyId);
    return record.userId;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async signSignupToken(phone: string): Promise<string> {
    const payload: SignupTokenPayload = { phone, typ: 'signup' };
    return this.jwt.signAsync(payload, { secret: this.env.SIGNUP_TOKEN_SECRET, expiresIn: SIGNUP_TOKEN_TTL_SECONDS });
  }

  async verifySignupToken(token: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<SignupTokenPayload>(token, { secret: this.env.SIGNUP_TOKEN_SECRET });
      if (payload.typ !== 'signup') throw new Error('wrong token type');
      return payload.phone;
    } catch {
      throw new UnauthorizedException('Verification expired. Please verify your mobile number again.');
    }
  }

  private async createRefreshToken(userId: string, familyId: string, meta: RequestMeta, scope: SessionScope, mfa: boolean): Promise<string> {
    const secret = randomBytes(32).toString('base64url');
    // Admin families keep the expiry of their first token, so rotation can't extend a session.
    const first = scope === 'admin' ? await this.prisma.refreshToken.findFirst({ where: { familyId }, orderBy: { createdAt: 'asc' }, select: { expiresAt: true } }) : null;
    const record = await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        scope,
        mfa,
        tokenHash: sha256(secret),
        expiresAt: first?.expiresAt ?? new Date(Date.now() + (scope === 'admin' ? ADMIN_SESSION_MS : this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000)),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      select: { id: true },
    });
    return `${record.id}.${secret}`;
  }

  private async find(raw: string) {
    const [id, secret] = raw.split('.');
    if (!id || !secret) return null;
    const record = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (!record) return null;
    const a = Buffer.from(record.tokenHash, 'hex');
    const b = Buffer.from(sha256(secret), 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? record : null;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
