import { Body, Get, HttpCode, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown, Param, Post, Query } from '@nestjs/common';
import { Prisma, type RiskKind } from '@prisma/client';
import { adminListQuerySchema, announcementSchema, riskResolveSchema, staffReplySchema, ticketStatusSchema, type AdminListQuery } from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Meta, RequestMeta } from '../common/request-meta';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupportService } from '../support/support.service';
import { AdminController, Perm, Sensitive } from './admin.guard';
import { cursorArgs, page } from './admin-users';

// ─── Support ────────────────────────────────────────────────────────────────

@AdminController('tickets')
export class AdminTicketsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('support.reply')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(q.status ? { status: q.status as never } : { status: { in: ['OPEN', 'AWAITING_USER'] } }),
      ...(q.type ? { category: q.type as never } : {}),
      ...(q.q ? { OR: [{ reference: q.q.toUpperCase() }, { subject: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    // Oldest waiting first, so nothing sits unanswered.
    const rows = await this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ lastMessageAt: 'asc' }, { id: 'asc' }],
      ...cursorArgs(q),
      include: { user: { select: { id: true, name: true, email: true, phone: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const p = page(rows, q.limit);
    return { ...p, items: p.items.map(({ messages, ...t }) => ({ ...t, lastMessage: messages[0]?.body.slice(0, 160) ?? '', lastFromStaff: messages[0]?.fromStaff ?? false })) };
  }

  @Get(':id')
  @Perm('support.reply')
  async detail(@Param('id') id: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true } }, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!t) throw new NotFoundException('Ticket not found');
    const staffIds = [...new Set(t.messages.map((m) => m.staffId).filter((s): s is string => !!s))];
    const staff = await this.prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } });
    return { ...t, messages: t.messages.map((m) => ({ ...m, staffName: staff.find((s) => s.id === m.staffId)?.name ?? null })) };
  }

  @Post(':id/reply')
  @HttpCode(200)
  @Perm('support.reply')
  async reply(@Param('id') id: string, @Body(zodBody(staffReplySchema)) body: z.output<typeof staffReplySchema>, @CurrentUser() admin: AuthUser) {
    await this.support.staffReply(admin.id, id, body.message, body.status === 'CLOSED' ? 'RESOLVED' : body.status);
    if (body.status === 'CLOSED') await this.prisma.supportTicket.update({ where: { id }, data: { status: 'CLOSED' } });
    return this.detail(id);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Perm('support.reply')
  async status(@Param('id') id: string, @Body(zodBody(ticketStatusSchema)) body: z.output<typeof ticketStatusSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    await this.prisma.supportTicket.update({ where: { id }, data: { status: body.status } });
    await this.audit.log({ action: 'support.status_changed', actorId: admin.id, entityType: 'SupportTicket', entityId: id, metadata: { status: body.status }, meta });
    return { ok: true };
  }
}

// ─── Risk ───────────────────────────────────────────────────────────────────

const SCAN_EVERY_MS = 30 * 60_000;

interface FlagRow {
  userId: string;
  key: string;
  details: Prisma.InputJsonObject;
}

/**
 * Heuristics that surface accounts for a human to look at — never automatic punishment.
 * Each flag has a dedupe key (the IP, day or transaction), so rescans don't repeat it.
 */
@Injectable()
export class RiskService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RiskService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.scan().catch((e) => this.logger.error(String(e))), SCAN_EVERY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(): Promise<Record<RiskKind, number>> {
    const [ip, rapid, quick, pan] = await Promise.all([this.multiAccountIp(), this.rapidDeposits(), this.quickWithdrawals(), this.panReuse()]);
    const out = {
      MULTI_ACCOUNT_IP: await this.save('MULTI_ACCOUNT_IP', ip),
      RAPID_DEPOSITS: await this.save('RAPID_DEPOSITS', rapid),
      QUICK_WITHDRAWAL: await this.save('QUICK_WITHDRAWAL', quick),
      PAN_REUSE: await this.save('PAN_REUSE', pan),
    };
    if (Object.values(out).some(Boolean)) this.logger.log(`Risk scan raised ${JSON.stringify(out)}`);
    return out;
  }

  /** 3+ sign-ups from one IP within 7 days. */
  private async multiAccountIp(): Promise<FlagRow[]> {
    const rows = await this.prisma.$queryRaw<{ ip: string; users: string[] }[]>`
      SELECT ip, array_agg(DISTINCT "actorId") AS users FROM "AuditLog"
      WHERE action = 'auth.register' AND ip IS NOT NULL AND "actorId" IS NOT NULL
        AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '7 days'
      GROUP BY ip HAVING COUNT(DISTINCT "actorId") >= 3`;
    return rows.flatMap((r) => r.users.map((u) => ({ userId: u, key: `ip:${r.ip}`, details: { ip: r.ip, accounts: r.users.length, others: r.users.filter((x) => x !== u).slice(0, 20) } })));
  }

  /** 3+ deposit attempts within 15 minutes, or 6+ in a day. */
  private async rapidDeposits(): Promise<FlagRow[]> {
    const rows = await this.prisma.$queryRaw<{ userId: string; day: string; burst: bigint; daily: bigint }[]>`
      SELECT d."userId", to_char(date_trunc('day', d."createdAt"), 'YYYY-MM-DD') AS day,
        MAX((SELECT COUNT(*) FROM "WalletTransaction" x WHERE x."userId" = d."userId" AND x.type = 'DEPOSIT'
             AND x."createdAt" BETWEEN d."createdAt" AND d."createdAt" + interval '15 minutes')) AS burst,
        COUNT(*) AS daily
      FROM "WalletTransaction" d
      WHERE d.type = 'DEPOSIT' AND d."createdAt" > (now() AT TIME ZONE 'UTC') - interval '2 days'
      GROUP BY d."userId", 2`;
    return rows
      .filter((r) => Number(r.burst) >= 3 || Number(r.daily) >= 6)
      .map((r) => ({ userId: r.userId, key: `day:${r.day}`, details: { day: r.day, depositsIn15Min: Number(r.burst), depositsThatDay: Number(r.daily) } }));
  }

  /** Withdrawal requested within 24 h of a deposit, with no contest played in between. */
  private async quickWithdrawals(): Promise<FlagRow[]> {
    const rows = await this.prisma.$queryRaw<{ userId: string; id: string; amount: number }[]>`
      SELECT w."userId", w.id, -w."amountX100" / 100.0 AS amount FROM "WalletTransaction" w
      WHERE w.type = 'WITHDRAWAL' AND w."createdAt" > (now() AT TIME ZONE 'UTC') - interval '7 days'
        AND EXISTS (SELECT 1 FROM "WalletTransaction" d WHERE d."userId" = w."userId" AND d.type = 'DEPOSIT' AND d.status = 'SUCCESS'
                    AND d."createdAt" BETWEEN w."createdAt" - interval '24 hours' AND w."createdAt")
        AND NOT EXISTS (SELECT 1 FROM "WalletTransaction" e WHERE e."userId" = w."userId" AND e.type = 'CONTEST_ENTRY'
                        AND e."createdAt" BETWEEN w."createdAt" - interval '24 hours' AND w."createdAt")`;
    return rows.map((r) => ({ userId: r.userId, key: `wd:${r.id}`, details: { withdrawalId: r.id, amount: Number(r.amount) } }));
  }

  /** Someone tried to submit a PAN already linked to another account. */
  private async panReuse(): Promise<FlagRow[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: 'kyc.pan_conflict', actorId: { not: null }, createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) } },
      select: { id: true, actorId: true, metadata: true },
    });
    return rows.map((r) => ({ userId: r.actorId!, key: `audit:${r.id}`, details: (r.metadata ?? {}) as Prisma.InputJsonObject }));
  }

  private async save(kind: RiskKind, rows: FlagRow[]): Promise<number> {
    if (!rows.length) return 0;
    const { count } = await this.prisma.riskFlag.createMany({ data: rows.map((r) => ({ userId: r.userId, kind, dedupeKey: r.key, details: r.details })), skipDuplicates: true });
    return count;
  }
}

@AdminController('risk')
export class AdminRiskController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('risk.review')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const rows = await this.prisma.riskFlag.findMany({
      where: { status: (q.status as never) ?? 'OPEN', ...(q.type ? { kind: q.type as never } : {}), ...(q.userId ? { userId: q.userId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
      include: { user: { select: { id: true, name: true, email: true, phone: true, status: true } } },
    });
    return page(rows, q.limit);
  }

  @Post('scan')
  @HttpCode(200)
  @Perm('risk.review')
  async scan(@CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const raised = await this.risk.scan();
    await this.audit.log({ action: 'admin.risk_scan', actorId: admin.id, metadata: raised, meta });
    return raised;
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @Perm('risk.review')
  async resolve(@Param('id') id: string, @Body(zodBody(riskResolveSchema)) body: z.output<typeof riskResolveSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const { count } = await this.prisma.riskFlag.updateMany({ where: { id, status: 'OPEN' }, data: { status: body.status, note: body.note, resolvedById: admin.id, resolvedAt: new Date() } });
    if (!count) throw new NotFoundException('Open flag not found');
    await this.audit.log({ action: `risk.${body.status.toLowerCase()}`, actorId: admin.id, entityType: 'RiskFlag', entityId: id, metadata: { note: body.note }, meta });
    return { ok: true };
  }
}

// ─── Announcements ──────────────────────────────────────────────────────────

@AdminController('announcements')
export class AdminAnnouncementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('announcements.send')
  async list() {
    const rows = await this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const authors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, createdBy: authors.find((a) => a.id === r.createdById)?.name ?? '—' }));
  }

  /** Stores the announcement, then fans out to the in-app centre + push in the background. */
  @Post()
  @Perm('announcements.send')
  @Sensitive()
  async send(@Body(zodBody(announcementSchema)) b: z.output<typeof announcementSchema>, @CurrentUser() admin: AuthUser, @Meta() meta: RequestMeta) {
    const a = await this.prisma.announcement.create({ data: { title: b.title, body: b.body, url: b.url ?? null, audience: b.audience, promotional: b.promotional, createdById: admin.id } });
    const where: Prisma.UserWhereInput = {
      role: 'USER',
      status: { in: ['ACTIVE', 'RESTRICTED', 'SELF_EXCLUDED'] },
      // Promotions never go to people on a break or restricted from play.
      ...(b.promotional ? { status: 'ACTIVE' } : {}),
      ...(b.audience === 'ACTIVE_30D' ? { lastLoginAt: { gt: new Date(Date.now() - 30 * 86_400_000) } } : {}),
    };
    const recipients = await this.notifications.broadcast(where, { type: 'ANNOUNCEMENT', title: b.title, body: b.body, url: b.url ?? null, dedupeKey: `announcement:${a.id}` }, { promotional: b.promotional });
    await this.prisma.announcement.update({ where: { id: a.id }, data: { recipients } });
    await this.audit.log({ action: 'admin.announcement_sent', actorId: admin.id, entityType: 'Announcement', entityId: a.id, metadata: { ...b, recipients } as Prisma.InputJsonObject, meta });
    return { ...a, recipients };
  }
}

// ─── Audit ──────────────────────────────────────────────────────────────────

@AdminController('audit')
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Perm('audit.view')
  async list(@Query(zodQuery(adminListQuerySchema)) q: AdminListQuery) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.userId ? { OR: [{ actorId: q.userId }, { entityId: q.userId }] } : {}),
        ...(q.q ? { OR: [{ entityId: q.q }, { actorId: q.q }, { ip: q.q }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
      include: { actor: { select: { id: true, name: true, role: true } } },
    });
    return page(rows, q.limit);
  }
}
