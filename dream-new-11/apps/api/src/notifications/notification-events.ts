import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Env, InjectEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const REMINDER_TICK_MS = 60_000;

const fmt = (amountX100: number, currency: string) => {
  const n = (Math.abs(amountX100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return currency === 'INR' ? `₹${n}` : `${n} DC`;
};

/**
 * What the app tells users, and when. Every message has a dedupe key so the triggers can be
 * called from retries, several API instances or repeated ticks without double notifications.
 */
@Injectable()
export class NotificationEvents implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationEvents.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectEnv() private readonly env: Env,
  ) {}

  /** For fire-and-forget calls: `void events.x().catch(events.logError)`. Notifying must never fail the caller. */
  readonly logError = (err: unknown): void => this.logger.error(`Notification failed: ${err instanceof Error ? err.stack : String(err)}`);

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.remindUpcoming().catch((e) => this.logger.error(String(e))), REMINDER_TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Users with a team for a match starting soon get one reminder per match. */
  async remindUpcoming(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ userId: string; matchId: string; home: string; away: string; joined: boolean }[]>`
      SELECT DISTINCT t."userId", m.id AS "matchId", h."shortName" AS home, a."shortName" AS away,
        EXISTS (SELECT 1 FROM "ContestEntry" e JOIN "Contest" c ON c.id = e."contestId" WHERE c."matchId" = m.id AND e."userId" = t."userId") AS joined
      FROM "UserTeam" t
      JOIN "Match" m ON m.id = t."matchId"
      JOIN "Team" h ON h.id = m."homeTeamId"
      JOIN "Team" a ON a.id = m."awayTeamId"
      WHERE m.status = 'UPCOMING'
        AND m."startTime" > (now() AT TIME ZONE 'UTC')
        AND m."startTime" <= (now() AT TIME ZONE 'UTC') + make_interval(mins => ${this.env.MATCH_REMINDER_MINUTES}::int)
        AND NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n."userId" = t."userId" AND n."dedupeKey" = 'reminder:' || m.id)`;
    const sent = await this.notifications.notifyMany(
      rows.map((r) => ({
        userId: r.userId,
        type: 'MATCH_REMINDER' as const,
        title: `${r.home} vs ${r.away} starts soon ⏰`,
        body: r.joined
          ? `Teams lock in ${this.env.MATCH_REMINDER_MINUTES} minutes. Check the lineups and your captain picks.`
          : `You have a team but haven’t joined a contest yet. Teams lock in ${this.env.MATCH_REMINDER_MINUTES} minutes.`,
        url: `/match/${r.matchId}`,
        dedupeKey: `reminder:${r.matchId}`,
      })),
    );
    return sent.length;
  }

  async contestJoined(userId: string, contestId: string): Promise<void> {
    const c = await this.contestInfo(contestId);
    if (!c) return;
    const teams = await this.prisma.contestEntry.findMany({ where: { contestId, userId }, select: { team: { select: { teamNumber: true } } } });
    await this.notifications.notify({
      userId,
      type: 'CONTEST_JOINED',
      title: `You’re in: ${c.name}`,
      body: `${c.title} · ${teams.map((t) => `T${t.team.teamNumber}`).join(', ')} entered. Good luck!`,
      url: `/contest/${contestId}`,
    });
  }

  /** Everyone with a team in a contest of this match. */
  async matchStarted(matchId: string): Promise<void> {
    const m = await this.prisma.match.findUnique({ where: { id: matchId }, select: { homeTeam: { select: { shortName: true } }, awayTeam: { select: { shortName: true } } } });
    if (!m) return;
    const users = await this.prisma.contestEntry.findMany({ where: { contest: { matchId } }, distinct: ['userId'], select: { userId: true } });
    await this.notifications.notifyMany(
      users.map((u) => ({
        userId: u.userId,
        type: 'MATCH_START' as const,
        title: `${m.homeTeam.shortName} vs ${m.awayTeam.shortName} is live 🏏`,
        body: 'Follow your teams’ points and ranks ball by ball.',
        url: `/match/${matchId}`,
        dedupeKey: `start:${matchId}`,
      })),
    );
  }

  /** One message per user with their best rank and total winnings in the contest. */
  async contestSettled(contestId: string): Promise<void> {
    const c = await this.contestInfo(contestId);
    if (!c) return;
    const rows = await this.prisma.contestEntry.groupBy({ by: ['userId'], where: { contestId }, _min: { rank: true }, _sum: { winningsX100: true } });
    await this.notifications.notifyMany(
      rows.map((r) => {
        const won = r._sum.winningsX100 ?? 0;
        return {
          userId: r.userId,
          type: 'CONTEST_RESULT' as const,
          title: won > 0 ? `You won ${fmt(won, c.currency)}! 🏆` : `Results: ${c.name}`,
          body: `${c.title} · your best rank #${r._min.rank ?? '–'}${won > 0 ? ' · credited to your wallet' : ''}`,
          url: `/contest/${contestId}`,
          dedupeKey: `result:${contestId}`,
        };
      }),
    );
  }

  async contestCancelled(contestId: string): Promise<void> {
    const c = await this.contestInfo(contestId);
    if (!c) return;
    const users = await this.prisma.contestEntry.findMany({ where: { contestId }, distinct: ['userId'], select: { userId: true } });
    await this.notifications.notifyMany(
      users.map((u) => ({
        userId: u.userId,
        type: 'CONTEST_CANCELLED' as const,
        title: `${c.name} was cancelled`,
        body: `${c.cancelReason ?? 'The contest could not run'}.${c.entryFeeX100 > 0 ? ' Your entry fee has been refunded.' : ''}`,
        url: `/contest/${contestId}`,
        dedupeKey: `cancel:${contestId}`,
      })),
    );
  }

  /** Deposits and withdrawals; one message per transaction state. */
  async transaction(transactionId: string): Promise<void> {
    const t = await this.prisma.walletTransaction.findUnique({ where: { id: transactionId } });
    if (!t || !t.userId) return;
    const amount = fmt(t.type === 'DEPOSIT' ? ((t.metadata as { requestedX100?: number } | null)?.requestedX100 ?? t.amountX100) : t.amountX100, t.currency);
    const copy =
      t.type === 'DEPOSIT'
        ? t.status === 'SUCCESS'
          ? { title: `${amount} added to your wallet`, body: 'Your payment was successful.' }
          : t.status === 'FAILED'
            ? { title: 'Payment failed', body: `Your payment of ${amount} didn’t go through. If money left your account, your bank will refund it.` }
            : null
        : t.type === 'WITHDRAWAL'
          ? t.status === 'PENDING'
            ? { title: 'Withdrawal requested', body: `${amount} is on hold while we review your request.` }
            : t.status === 'SUCCESS'
              ? (() => {
                  const m = t.metadata as { payout?: number; tds?: number } | null;
                  const paid = m?.payout !== undefined ? fmt(m.payout * 100, t.currency) : amount;
                  return { title: `${paid} is on its way 💸`, body: m?.tds ? `Your withdrawal was approved. TDS of ${fmt(m.tds * 100, t.currency)} was deducted as required by law.` : 'Your withdrawal was approved and sent to your bank.' };
                })()
              : { title: 'Withdrawal not approved', body: `${t.description}. ${amount} is back in your winnings.` }
          : null;
    if (!copy) return;
    await this.notifications.notify({ userId: t.userId, type: 'TRANSACTION', ...copy, url: '/wallet', dedupeKey: `tx:${t.id}:${t.status}` });
  }

  async kycReviewed(userId: string, verified: boolean, note?: string | null): Promise<void> {
    await this.notifications.notify({
      userId,
      type: 'KYC',
      title: verified ? 'KYC verified ✅' : 'KYC needs another look',
      body: verified ? 'You can now withdraw your winnings.' : `${note ?? 'Please check your details'} — resubmit from the wallet.`,
      url: '/wallet/kyc',
    });
  }

  async supportReplied(userId: string, ticketId: string, reference: string): Promise<void> {
    await this.notifications.notify({ userId, type: 'SUPPORT', title: `Support replied (${reference})`, body: 'Tap to read the reply.', url: `/support/${ticketId}` });
  }

  private async contestInfo(contestId: string) {
    const c = await this.prisma.contest.findUnique({
      where: { id: contestId },
      select: { name: true, currency: true, entryFeeX100: true, cancelReason: true, match: { select: { homeTeam: { select: { shortName: true } }, awayTeam: { select: { shortName: true } } } } },
    });
    return c ? { ...c, title: `${c.match.homeTeam.shortName} vs ${c.match.awayTeam.shortName}` } : null;
  }
}
