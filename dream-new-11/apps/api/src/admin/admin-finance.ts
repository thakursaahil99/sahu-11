import { BadRequestException, Body, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { adminListQuerySchema, kycReviewSchema, withdrawalRejectSchema, type AdminListQuery } from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { NotificationEvents } from '../notifications/notification-events';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminController, Perm, Sensitive } from './admin.guard';
import { cursorArgs, page } from './admin-users';

const userSelect = { select: { id: true, name: true, email: true, phone: true } } as const;

@AdminController('transactions')
export class AdminTransactionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Perm('finance.view')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const where: Prisma.WalletTransactionWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.type ? { type: q.type as never } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.q ? { OR: [{ reference: q.q }, { id: q.q }, { description: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.walletTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q), include: { user: userSelect } });
    const p = page(rows, q.limit);
    return { ...p, items: p.items.map((t) => ({ id: t.id, type: t.type, status: t.status, currency: t.currency, amount: t.amountX100 / 100, description: t.description, reference: t.reference, user: t.user, createdAt: t.createdAt, metadata: t.metadata })) };
  }
}

@AdminController('withdrawals')
export class AdminWithdrawalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  @Get()
  @Perm('finance.view')
  async pending() {
    const rows = await this.prisma.walletTransaction.findMany({ where: { type: 'WITHDRAWAL', status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 200, include: { user: { select: { id: true, name: true, email: true, phone: true, kyc: { select: { status: true, fullName: true, panMasked: true } } } } } });
    return rows.map((t) => ({ id: t.id, amount: -t.amountX100 / 100, user: t.user, createdAt: t.createdAt }));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Perm('withdrawals.approve')
  @Sensitive()
  async approve(@Param('id') id: string, @CurrentUser() admin: AuthUser) {
    await this.assertNotOwn(id, admin.id);
    await this.wallet.approveWithdrawal(id, admin.id);
    return { ok: true };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Perm('withdrawals.approve')
  @Sensitive()
  async reject(@Param('id') id: string, @Body(zodBody(withdrawalRejectSchema)) body: z.output<typeof withdrawalRejectSchema>, @CurrentUser() admin: AuthUser) {
    await this.assertNotOwn(id, admin.id);
    await this.wallet.rejectWithdrawal(id, admin.id, body.reason);
    return { ok: true };
  }

  /** Four-eyes rule: staff can't approve their own payouts. */
  private async assertNotOwn(id: string, adminId: string) {
    const t = await this.prisma.walletTransaction.findUnique({ where: { id }, select: { userId: true } });
    if (!t) throw new NotFoundException('Withdrawal not found');
    if (t.userId === adminId) throw new BadRequestException('You can’t process your own withdrawal');
  }
}

@AdminController('kyc')
export class AdminKycController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: NotificationEvents,
  ) {}

  @Get()
  @Perm('kyc.review')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const rows = await this.prisma.kycRecord.findMany({
      where: { status: (q.status as never) ?? 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      take: 200,
      include: { user: { select: { id: true, name: true, email: true, phone: true, dob: true, createdAt: true } } },
    });
    // Same PAN hash on another account is the strongest multi-account signal.
    const clashes = await this.prisma.kycRecord.groupBy({ by: ['panHash'], where: { panHash: { in: rows.map((r) => r.panHash) } }, _count: true });
    const dup = new Set(clashes.filter((c) => c._count > 1).map((c) => c.panHash));
    return rows.map((r) => ({ userId: r.userId, status: r.status, fullName: r.fullName, panMasked: r.panMasked, reviewNote: r.reviewNote, submittedAt: r.submittedAt, reviewedAt: r.reviewedAt, user: r.user, panSharedWithOtherAccount: dup.has(r.panHash) }));
  }

  @Post(':userId/review')
  @HttpCode(200)
  @Perm('kyc.review')
  async review(@Param('userId') userId: string, @Body(zodBody(kycReviewSchema)) body: z.output<typeof kycReviewSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    if (userId === admin.id) throw new BadRequestException('You can’t review your own KYC');
    const { count } = await this.prisma.kycRecord.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: body.approve ? 'VERIFIED' : 'REJECTED', reviewNote: body.approve ? null : body.note, reviewedAt: new Date() },
    });
    if (!count) throw new NotFoundException('No pending KYC for this user');
    await this.audit.log({ action: body.approve ? 'kyc.verified' : 'kyc.rejected', actorId: admin.id, entityType: 'User', entityId: userId, metadata: { note: body.note }, meta });
    void this.events.kycReviewed(userId, body.approve, body.note).catch(this.events.logError);
    return { ok: true };
  }
}
