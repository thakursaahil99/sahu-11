import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { breakupTotal } from '@dream11/shared';
import { Env, InjectEnv } from '../config/config.module';
import { contestTemplatesEnabled } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationEvents } from '../notifications/notification-events';
import { toStoredBreakup } from './contest.mapper';
import { DEMO_TEMPLATES } from './contest-templates';

const TICK_MS = 30_000;
/** Private contests need at least this many teams to run. */
const PRIVATE_MIN_ENTRIES = 2;

/**
 * Background housekeeping:
 * - creates the default contest set for upcoming matches (demo, or when enabled);
 * - at the deadline, locks contests that will run and cancels those that won't.
 */
@Injectable()
export class ContestLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ContestLifecycleService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly events: NotificationEvents,
    @InjectEnv() private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (contestTemplatesEnabled(this.env)) await this.ensureTemplates();
      await this.closeStarted();
    } catch (err) {
      this.logger.error(`Contest lifecycle failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
    }
  }

  /** Idempotent: (matchId, templateKey) is unique, so duplicates are skipped. */
  async ensureTemplates(): Promise<number> {
    const matches = await this.prisma.match.findMany({
      where: { status: 'UPCOMING', startTime: { gt: new Date() }, sport: { enabled: true } },
      select: { id: true },
    });
    if (matches.length === 0) return 0;
    const rows: Prisma.ContestCreateManyInput[] = matches.flatMap((m) =>
      DEMO_TEMPLATES.map((t) => ({
        matchId: m.id,
        templateKey: t.key,
        type: t.type,
        name: t.name,
        totalSpots: t.totalSpots,
        maxEntriesPerUser: t.maxEntriesPerUser,
        guaranteed: t.guaranteed,
        currency: t.currency,
        prizePoolX100: Math.round(breakupTotal(t.breakup) * 100),
        prizeBreakup: toStoredBreakup(t.breakup) as unknown as Prisma.InputJsonArray,
      })),
    );
    const { count } = await this.prisma.contest.createMany({ data: rows, skipDuplicates: true });
    if (count > 0) this.logger.log(`Created ${count} contests for ${matches.length} upcoming matches`);
    return count;
  }

  /** Contests whose match has started (or been abandoned) stop accepting entries. */
  async closeStarted(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.contest.findMany({
      where: { status: 'OPEN', match: { OR: [{ startTime: { lte: now } }, { status: { not: 'UPCOMING' } }] } },
      select: { id: true, type: true, guaranteed: true, totalSpots: true, filledSpots: true, match: { select: { status: true } } },
    });

    let locked = 0;
    let cancelled = 0;
    for (const c of due) {
      const reason =
        c.match.status === 'ABANDONED'
          ? 'Match abandoned'
          : c.type === 'PRIVATE'
            ? c.filledSpots < PRIVATE_MIN_ENTRIES
              ? `Needed at least ${PRIVATE_MIN_ENTRIES} teams`
              : null
            : !c.guaranteed && c.filledSpots < c.totalSpots
              ? 'Contest did not fill up before the deadline'
              : null;

      // Conditional update: only transition contests still OPEN (safe if two instances race).
      const { count } = await this.prisma.contest.updateMany({
        where: { id: c.id, status: 'OPEN' },
        data: reason ? { status: 'CANCELLED', cancelReason: reason } : { status: 'LOCKED' },
      });
      if (count && reason) {
        cancelled++;
        await this.wallet.refundContest(c.id);
        void this.events.contestCancelled(c.id).catch(this.events.logError);
      } else if (count) locked++;
    }
    if (locked || cancelled) this.logger.log(`Deadline passed: locked ${locked}, cancelled ${cancelled} contests`);
  }
}
