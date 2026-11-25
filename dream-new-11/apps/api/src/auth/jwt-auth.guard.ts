import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@dream11/shared';
import type { Request } from 'express';
import { Env, InjectEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

export type SessionScope = 'app' | 'admin';

export interface AuthUser {
  id: string;
  role: UserRole;
  scope: SessionScope;
  /** Admin sessions: the second factor was verified. */
  mfa: boolean;
}

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  typ: 'access';
  scope?: SessionScope;
  mfa?: boolean;
}

type AuthedRequest = Request & { user?: AuthUser };

const IS_PUBLIC = 'isPublic';

/**
 * Access tokens are stateless, so a deleted or suspended account is also checked here.
 * Results are cached briefly per user; the instance that blocks a user evicts it at once.
 */
const STATUS_TTL_MS = 30_000;
const statusCache = new Map<string, { blocked: boolean; at: number }>();
export const forgetUserStatus = (userId: string) => statusCache.delete(userId);

/** Marks a route as reachable without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});

/** Global guard: every route requires a valid Bearer access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Please log in to continue');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.env.JWT_ACCESS_SECRET });
      if (payload.typ !== 'access') throw new Error('wrong token type');
    } catch {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    if (await this.isBlocked(payload.sub)) throw new UnauthorizedException('This account is no longer active');
    req.user = { id: payload.sub, role: payload.role, scope: payload.scope ?? 'app', mfa: payload.mfa ?? false };
    return true;
  }

  private async isBlocked(userId: string): Promise<boolean> {
    const hit = statusCache.get(userId);
    if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.blocked;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    const blocked = !u || u.status === 'DELETED' || u.status === 'SUSPENDED';
    if (statusCache.size > 50_000) statusCache.clear();
    statusCache.set(userId, { blocked, at: Date.now() });
    return blocked;
  }
}
