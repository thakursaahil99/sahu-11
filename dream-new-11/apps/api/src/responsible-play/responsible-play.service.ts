import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, type PlayLimits } from '@prisma/client';
import { DEFAULT_RESTRICTED_STATES, LIMIT_COOLING_OFF_HOURS, stateName, type DepositLimitsInput, type ResponsiblePlayDto } from '@dream11/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { Env, InjectEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;
const WINDOWS = { daily: 1, weekly: 7, monthly: 30 } as const;
type Window = keyof typeof WINDOWS;
const KEYS: Record<Window, 'dailyDepositX100' | 'weeklyDepositX100' | 'monthlyDepositX100'> = {
  daily: 'dailyDepositX100',
  weekly: 'weeklyDepositX100',
  monthly: 'monthlyDepositX100',
};

const rupees = (x100: number | null | undefined) => (x100 == null ? null : x100 / 100);
const fmt = (x100: number) => `₹${(x100 / 100).toLocaleString('en-IN')}`;

/**
 * Responsible-play tools. Protective changes apply immediately (lowering a limit, taking a
 * break); anything that loosens protection waits a cooling-off period and can't be rushed.
 */
@Injectable()
export class ResponsiblePlayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectEnv() private readonly env: Env,
  ) {}

  /**
   * Geo-blocking for real money (deposits and paid entries — never withdrawals): the player
   * must have declared a state that isn't restricted, and, when the CDN sends a country
   * header, be in India.
   */
  async assertRealMoneyRegion(userId: string, meta: RequestMeta): Promise<void> {
    if (meta.country && meta.country !== 'IN') {
      await this.audit.log({ action: 'compliance.geo_blocked', actorId: userId, metadata: { country: meta.country }, meta });
      throw new ForbiddenException({ message: 'Real-money play is only available in India', code: 'GEO_BLOCKED' });
    }
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { state: true } });
    if (!u?.state) throw new ForbiddenException({ message: 'Add your state of residence in your profile to play for real money', code: 'STATE_REQUIRED' });
    const restricted = this.env.RESTRICTED_STATES ?? DEFAULT_RESTRICTED_STATES;
    if (restricted.includes(u.state)) {
      await this.audit.log({ action: 'compliance.state_blocked', actorId: userId, metadata: { state: u.state }, meta });
      throw new ForbiddenException({ message: `Real-money play isn’t available in ${stateName(u.state) ?? u.state}. Free and practice contests are open to you.`, code: 'GEO_BLOCKED' });
    }
  }

  async get(userId: string): Promise<ResponsiblePlayDto> {
    const [user, limits] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true, restrictionReason: true } }),
      this.current(userId),
    ]);
    const usage = await this.usage(userId);
    const onBreak = !!limits?.excludedUntil && limits.excludedUntil > new Date();
    const pending = limits?.pending as Partial<Record<Window, number | null>> | null | undefined;
    return {
      status: user.status === 'RESTRICTED' ? 'RESTRICTED' : onBreak ? 'ON_BREAK' : 'ACTIVE',
      limits: { daily: rupees(limits?.dailyDepositX100), weekly: rupees(limits?.weeklyDepositX100), monthly: rupees(limits?.monthlyDepositX100) },
      pending: pending ? Object.fromEntries(Object.entries(pending).map(([w, v]) => [w, rupees(v)])) : null,
      pendingEffectiveAt: limits?.pendingEffectiveAt?.toISOString() ?? null,
      usage: { daily: usage.daily / 100, weekly: usage.weekly / 100, monthly: usage.monthly / 100 },
      excludedUntil: onBreak ? limits!.excludedUntil!.toISOString() : null,
      restrictionReason: user.status === 'RESTRICTED' ? user.restrictionReason : null,
    };
  }

  /** Decreases (and new limits) apply now; increases and removals are queued for the cooling-off period. */
  async setLimits(userId: string, input: DepositLimitsInput, meta: RequestMeta): Promise<ResponsiblePlayDto> {
    const cur = await this.current(userId);
    const now: Partial<Record<Window, number | null>> = {};
    const later: Partial<Record<Window, number | null>> = {};
    for (const w of Object.keys(WINDOWS) as Window[]) {
      const next = input[w] === null ? null : Math.round(input[w]! * 100);
      const prev = cur?.[KEYS[w]] ?? null;
      if (next === prev) continue;
      const tighter = next !== null && (prev === null || next < prev);
      if (tighter) now[w] = next;
      else later[w] = next;
    }
    if (!Object.keys(now).length && !Object.keys(later).length) return this.get(userId);

    const data: Prisma.PlayLimitsUpdateInput = {};
    for (const [w, v] of Object.entries(now)) data[KEYS[w as Window]] = v;
    // Any change replaces an earlier pending request (and restarts its clock).
    if (Object.keys(later).length) {
      data.pending = later as Prisma.InputJsonValue;
      data.pendingEffectiveAt = new Date(Date.now() + LIMIT_COOLING_OFF_HOURS * 3_600_000);
    } else {
      data.pending = Prisma.DbNull;
      data.pendingEffectiveAt = null;
    }
    await this.prisma.playLimits.upsert({ where: { userId }, create: { userId, ...(data as object) }, update: data });
    await this.audit.log({ action: 'play.limits_changed', actorId: userId, metadata: { applied: now, pending: later }, meta });
    return this.get(userId);
  }

  async cancelPending(userId: string): Promise<ResponsiblePlayDto> {
    await this.prisma.playLimits.updateMany({ where: { userId }, data: { pending: Prisma.DbNull, pendingEffectiveAt: null } });
    return this.get(userId);
  }

  /** Take a break / self-exclude. Can be extended, never shortened. */
  async takeBreak(userId: string, days: number, meta: RequestMeta): Promise<ResponsiblePlayDto> {
    const until = new Date(Date.now() + days * DAY);
    const cur = await this.current(userId);
    if (cur?.excludedUntil && cur.excludedUntil > until) throw new BadRequestException('You already have a longer break in place');
    await this.prisma.$transaction([
      this.prisma.playLimits.upsert({ where: { userId }, create: { userId, excludedUntil: until }, update: { excludedUntil: until } }),
      this.prisma.user.updateMany({ where: { id: userId, status: 'ACTIVE' }, data: { status: 'SELF_EXCLUDED' } }),
    ]);
    await this.audit.log({ action: 'play.break_started', actorId: userId, metadata: { days, until: until.toISOString() }, meta });
    return this.get(userId);
  }

  /** Throws if the user may not join contests or create teams right now. */
  async assertCanPlay(userId: string): Promise<void> {
    const block = await this.block(userId);
    if (block) throw new ForbiddenException(block);
  }

  /** Throws if this deposit would break a limit (or the user can't play). */
  async assertDepositAllowed(userId: string, amountX100: number): Promise<void> {
    await this.assertCanPlay(userId);
    const limits = await this.current(userId);
    if (!limits) return;
    const usage = await this.usage(userId);
    for (const w of Object.keys(WINDOWS) as Window[]) {
      const cap = limits[KEYS[w]];
      if (cap !== null && usage[w] + amountX100 > cap) {
        const left = Math.max(0, cap - usage[w]);
        throw new ForbiddenException(
          left === 0 ? `You’ve reached your ${w} deposit limit of ${fmt(cap)}` : `This would pass your ${w} deposit limit. You can add up to ${fmt(left)} more.`,
        );
      }
    }
  }

  private async block(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, playLimits: { select: { excludedUntil: true } } } });
    if (!user) return 'Account not found';
    if (user.status === 'RESTRICTED' || user.status === 'SUSPENDED') return 'Your account is restricted from playing. Contact support for help.';
    const until = user.playLimits?.excludedUntil;
    if (until && until > new Date()) {
      return `You’re on a break until ${until.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}. You can still view your account and withdraw.`;
    }
    if (user.status === 'SELF_EXCLUDED') await this.prisma.user.updateMany({ where: { id: userId, status: 'SELF_EXCLUDED' }, data: { status: 'ACTIVE' } });
    return null;
  }

  /** Limits with any matured pending change applied (lazily, on read). */
  private async current(userId: string): Promise<PlayLimits | null> {
    const row = await this.prisma.playLimits.findUnique({ where: { userId } });
    if (!row?.pendingEffectiveAt || row.pendingEffectiveAt > new Date()) return row;
    const pending = (row.pending ?? {}) as Partial<Record<Window, number | null>>;
    const data: Prisma.PlayLimitsUpdateInput = { pending: Prisma.DbNull, pendingEffectiveAt: null };
    for (const [w, v] of Object.entries(pending)) data[KEYS[w as Window]] = v;
    return this.prisma.playLimits.update({ where: { userId }, data });
  }

  /** Paise deposited (successful, or pending in the last 30 min) in each rolling window. */
  private async usage(userId: string): Promise<Record<Window, number>> {
    const [row] = await this.prisma.$queryRaw<{ daily: bigint | null; weekly: bigint | null; monthly: bigint | null }[]>`
      SELECT
        SUM(amt) FILTER (WHERE "createdAt" > (now() AT TIME ZONE 'UTC') - interval '1 day') AS daily,
        SUM(amt) FILTER (WHERE "createdAt" > (now() AT TIME ZONE 'UTC') - interval '7 days') AS weekly,
        SUM(amt) AS monthly
      FROM (
        SELECT COALESCE(("metadata"->>'requestedX100')::int, "amountX100") AS amt, "createdAt"
        FROM "WalletTransaction"
        WHERE "userId" = ${userId} AND type = 'DEPOSIT' AND currency = 'INR' AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '30 days'
          AND (status = 'SUCCESS' OR (status = 'PENDING' AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '30 minutes'))
      ) d`;
    return { daily: Number(row?.daily ?? 0), weekly: Number(row?.weekly ?? 0), monthly: Number(row?.monthly ?? 0) };
  }
}
