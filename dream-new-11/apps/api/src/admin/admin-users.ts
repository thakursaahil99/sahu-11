import { BadRequestException, Body, ConflictException, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { adminListQuerySchema, changeRoleSchema, isStaff, restrictUserSchema, type AdminListQuery } from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, forgetUserStatus } from '../auth/jwt-auth.guard';
import { TokenService } from '../auth/token.service';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminController, Perm, Sensitive } from './admin.guard';

const x100 = (n: number | bigint | null | undefined) => Number(n ?? 0) / 100;

/** Cursor pagination on id (rows are ordered newest first by createdAt, id). */
export function page<T extends { id: string }>(rows: T[], limit: number) {
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: more ? items[items.length - 1]!.id : null };
}
export const cursorArgs = (q: AdminListQuery) => ({ take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });

@AdminController('overview')
export class AdminDashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Perm('dashboard.view')
  async overview() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const [users, newToday, liveMatches, upcoming, openContests, pendingWithdrawals, pendingKyc, openTickets, openFlags, money, signups] = await Promise.all([
      this.prisma.user.count({ where: { role: 'USER', deletedAt: null } }),
      this.prisma.user.count({ where: { role: 'USER', deletedAt: null, createdAt: { gte: dayAgo } } }),
      this.prisma.match.count({ where: { status: 'LIVE' } }),
      this.prisma.match.count({ where: { status: 'UPCOMING', startTime: { gt: now } } }),
      this.prisma.contest.count({ where: { status: { in: ['OPEN', 'LOCKED'] } } }),
      this.prisma.walletTransaction.aggregate({ where: { type: 'WITHDRAWAL', status: 'PENDING' }, _count: true, _sum: { amountX100: true } }),
      this.prisma.kycRecord.count({ where: { status: 'PENDING' } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.riskFlag.count({ where: { status: 'OPEN' } }),
      this.prisma.$queryRaw<{ type: string; currency: string; total: bigint }[]>`
        SELECT type::text, currency::text, SUM(ABS("amountX100")) AS total FROM "WalletTransaction"
        WHERE status = 'SUCCESS' AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '7 days' AND "userId" IS NOT NULL GROUP BY type, currency`,
      this.prisma.$queryRaw<{ day: string; n: bigint }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, COUNT(*) AS n FROM "User"
        WHERE role = 'USER' AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '14 days' GROUP BY 1 ORDER BY 1`,
    ]);
    const sum = (type: string, currency: string) => x100(money.find((m) => m.type === type && m.currency === currency)?.total);
    return {
      users,
      newToday,
      liveMatches,
      upcomingMatches: upcoming,
      openContests,
      pendingWithdrawals: { count: pendingWithdrawals._count, amount: x100(-(pendingWithdrawals._sum.amountX100 ?? 0)) },
      pendingKyc,
      openTickets,
      openFlags,
      week: {
        deposits: sum('DEPOSIT', 'INR'),
        withdrawals: sum('WITHDRAWAL', 'INR'),
        entryFees: sum('CONTEST_ENTRY', 'INR'),
        winningsInr: sum('CONTEST_WINNING', 'INR'),
        winningsDemo: sum('CONTEST_WINNING', 'DEMO'),
      },
      signups: signups.map((s) => ({ day: s.day, count: Number(s.n) })),
    };
  }
}

@AdminController('users')
export class AdminUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('users.view')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const term = q.q?.trim();
    const where: Prisma.UserWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.role === 'STAFF' ? { role: { not: 'USER' } } : q.role ? { role: q.role as never } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
              // Only treat the term as a phone number when it looks like one (not "dreamnew11").
              ...(/^[+\d\s-]{4,}$/.test(term) ? [{ phone: { contains: term.replace(/\D/g, '') } }] : []),
              { id: term },
              { referralCode: term.toUpperCase() },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true, lastLoginAt: true, kyc: { select: { status: true } }, _count: { select: { contestEntries: true, riskFlags: { where: { status: 'OPEN' } } } } },
    });
    const p = page(rows, q.limit);
    return {
      ...p,
      items: p.items.map((u) => ({ ...u, kycStatus: u.kyc?.status ?? 'NOT_STARTED', entries: u._count.contestEntries, openFlags: u._count.riskFlags, kyc: undefined, _count: undefined })),
    };
  }

  @Get(':id')
  @Perm('users.view')
  async detail(@Param('id') id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: { kyc: true, playLimits: true, settings: true, _count: { select: { teams: true, contestEntries: true, tickets: true } } },
    });
    if (!u) throw new NotFoundException('User not found');
    const [demo, inr, txs, entries, flags, audit] = await Promise.all([
      this.wallet.balance(id, 'DEMO'),
      this.wallet.balance(id, 'INR'),
      this.prisma.walletTransaction.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 15 }),
      this.prisma.contestEntry.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { id: true, pointsX10: true, rank: true, winningsX100: true, createdAt: true, contest: { select: { id: true, name: true, status: true, currency: true, match: { select: { homeTeam: { select: { shortName: true } }, awayTeam: { select: { shortName: true } } } } } } },
      }),
      this.prisma.riskFlag.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.auditLog.findMany({ where: { OR: [{ actorId: id }, { entityId: id }] }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const { passwordHash: _p, mfaSecret: _m, mfaLastStep: _s, ...safe } = u;
    return {
      user: { ...safe, kyc: u.kyc ? { status: u.kyc.status, fullName: u.kyc.fullName, panMasked: u.kyc.panMasked, reviewNote: u.kyc.reviewNote, submittedAt: u.kyc.submittedAt } : null, mfaEnabled: !!u.mfaEnabledAt },
      balances: { DEMO: demo, INR: inr },
      transactions: txs.map((t) => ({ id: t.id, type: t.type, status: t.status, currency: t.currency, amount: x100(t.amountX100), description: t.description, createdAt: t.createdAt })),
      entries: entries.map((e) => ({ id: e.id, contestId: e.contest.id, contest: e.contest.name, match: `${e.contest.match.homeTeam.shortName} vs ${e.contest.match.awayTeam.shortName}`, status: e.contest.status, points: e.pointsX10 / 10, rank: e.rank, winnings: x100(e.winningsX100), currency: e.contest.currency, createdAt: e.createdAt })),
      flags,
      audit,
    };
  }

  @Post(':id/restrict')
  @HttpCode(200)
  @Perm('users.restrict')
  async restrict(@Param('id') id: string, @Body(zodBody(restrictUserSchema)) body: z.output<typeof restrictUserSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    await this.setStatus(id, admin, 'RESTRICTED', body.reason, meta);
    return { ok: true };
  }

  @Post(':id/unrestrict')
  @HttpCode(200)
  @Perm('users.restrict')
  async unrestrict(@Param('id') id: string, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    await this.setStatus(id, admin, 'ACTIVE', null, meta);
    return { ok: true };
  }

  /** Blocks sign-in entirely and ends every session. */
  @Post(':id/suspend')
  @HttpCode(200)
  @Perm('users.restrict')
  @Sensitive()
  async suspend(@Param('id') id: string, @Body(zodBody(restrictUserSchema)) body: z.output<typeof restrictUserSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    await this.setStatus(id, admin, 'SUSPENDED', body.reason, meta);
    await this.tokens.revokeAllForUser(id);
    forgetUserStatus(id);
    return { ok: true };
  }

  @Post(':id/role')
  @HttpCode(200)
  @Perm('users.roles')
  @Sensitive()
  async role(@Param('id') id: string, @Body(zodBody(changeRoleSchema)) body: z.output<typeof changeRoleSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    if (id === admin.id) throw new BadRequestException('You can’t change your own role');
    const u = await this.prisma.user.findUnique({ where: { id }, select: { role: true, email: true, passwordHash: true, status: true } });
    if (!u || u.status === 'DELETED') throw new NotFoundException('User not found');
    if (isStaff(body.role as never) && (!u.email || !u.passwordHash)) throw new BadRequestException('Staff need an email and password to sign in to the panel');
    if (u.role === 'SUPER_ADMIN' && body.role !== 'SUPER_ADMIN') {
      const supers = await this.prisma.user.count({ where: { role: 'SUPER_ADMIN', status: { notIn: ['SUSPENDED', 'DELETED'] } } });
      if (supers <= 1) throw new ConflictException('There must be at least one super admin');
    }
    await this.prisma.user.update({ where: { id }, data: { role: body.role } });
    // Old tokens carry the old role: end their sessions.
    await this.tokens.revokeAllForUser(id);
    await this.audit.log({ action: 'admin.user_role_changed', actorId: admin.id, entityType: 'User', entityId: id, metadata: { from: u.role, to: body.role }, meta });
    return { ok: true };
  }

  /** Lost authenticator: turns 2FA off so the staff member can enrol again. */
  @Post(':id/reset-mfa')
  @HttpCode(200)
  @Perm('users.roles')
  @Sensitive()
  async resetMfa(@Param('id') id: string, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    await this.prisma.user.update({ where: { id }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null } });
    await this.tokens.revokeAllForUser(id);
    await this.audit.log({ action: 'admin.user_mfa_reset', actorId: admin.id, entityType: 'User', entityId: id, meta });
    return { ok: true };
  }

  private async setStatus(id: string, admin: AuthUser, status: 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED', reason: string | null, meta: RequestMeta) {
    if (id === admin.id) throw new BadRequestException('You can’t change your own account status');
    const u = await this.prisma.user.findUnique({ where: { id }, select: { status: true, role: true } });
    if (!u || u.status === 'DELETED') throw new NotFoundException('User not found');
    if (u.role === 'SUPER_ADMIN' && admin.role !== 'SUPER_ADMIN') throw new BadRequestException('Only a super admin can do this to a super admin');
    await this.prisma.user.update({ where: { id }, data: { status, restrictionReason: status === 'ACTIVE' ? null : reason } });
    forgetUserStatus(id);
    await this.audit.log({ action: `admin.user_${status.toLowerCase()}`, actorId: admin.id, entityType: 'User', entityId: id, metadata: { from: u.status, reason }, meta });
  }
}
