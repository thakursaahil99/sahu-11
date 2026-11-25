import { applyDecorators, CanActivate, Controller, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { can, isStaff, REAUTH_HEADER, type AdminPermission } from '@dream11/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { Env, InjectEnv } from '../config/config.module';
import { adminMfaRequired } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

const PERMS = 'adminPerms';
const SENSITIVE = 'adminSensitive';
const NO_MFA = 'adminNoMfa';

export interface ReauthPayload {
  sub: string;
  typ: 'reauth';
}

/** Requires these permissions (any staff role that has all of them). */
export const Perm = (...p: AdminPermission[]) => SetMetadata(PERMS, p);
/** Requires a fresh step-up (password or 2FA within the last 5 minutes). */
export const Sensitive = () => SetMetadata(SENSITIVE, true);
/** Reachable before 2FA is set up (only the MFA enrolment and session routes). */
export const AllowWithoutMfa = () => SetMetadata(NO_MFA, true);

/**
 * Every admin route: an admin-scope session (issued only by /admin/auth), a staff role that
 * is re-read from the database (so demotions apply at once), 2FA when policy requires it,
 * the route's permissions, and a step-up token for sensitive actions.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('Please log in to continue');
    if (user.scope !== 'admin') throw new ForbiddenException({ message: 'Sign in to the admin panel to do this', code: 'ADMIN_SESSION_REQUIRED' });

    const row = await this.prisma.user.findUnique({ where: { id: user.id }, select: { role: true, status: true } });
    if (!row || !isStaff(row.role) || row.status === 'SUSPENDED' || row.status === 'DELETED') throw new ForbiddenException('You no longer have admin access');
    user.role = row.role;

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (adminMfaRequired(this.env) && !user.mfa && !this.reflector.getAllAndOverride<boolean>(NO_MFA, targets)) {
      throw new ForbiddenException({ message: 'Set up two-factor authentication to continue', code: 'MFA_REQUIRED' });
    }

    const perms = this.reflector.getAllAndOverride<AdminPermission[]>(PERMS, targets) ?? [];
    if (!perms.every((p) => can(row.role, p))) throw new ForbiddenException({ message: 'Your role doesn’t allow this', code: 'FORBIDDEN_ROLE' });

    if (this.reflector.getAllAndOverride<boolean>(SENSITIVE, targets)) {
      const token = req.headers[REAUTH_HEADER];
      try {
        if (typeof token !== 'string') throw new Error('missing');
        const p = await this.jwt.verifyAsync<ReauthPayload>(token, { secret: this.env.JWT_ACCESS_SECRET });
        if (p.typ !== 'reauth' || p.sub !== user.id) throw new Error('mismatch');
      } catch {
        throw new ForbiddenException({ message: 'Confirm it’s you to continue', code: 'REAUTH_REQUIRED' });
      }
    }
    return true;
  }
}

/** `@AdminController('users')` → /admin/users, guarded by AdminGuard. */
export const AdminController = (path: string) => applyDecorators(Controller(`admin/${path}`), UseGuards(AdminGuard));
