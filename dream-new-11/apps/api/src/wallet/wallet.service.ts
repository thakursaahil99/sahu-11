import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { Prisma, WalletBucket, WalletCurrency } from '@prisma/client';
import {
  computeTds,
  financialYearStart,
  BalanceDto,
  DEPOSIT_LIMITS,
  DepositOrderDto,
  KycDto,
  kycSchema,
  MIN_WITHDRAWAL,
  WalletDto,
  WalletTxDto,
} from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { Env, InjectEnv } from '../config/config.module';
import { paidContestsEnabled } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEvents } from '../notifications/notification-events';
import { ResponsiblePlayService } from '../responsible-play/responsible-play.service';
import { LedgerService, Line, SystemAccount } from './ledger.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider';

type KycInput = z.output<typeof kycSchema>;

const SYSTEM_ACCOUNTS: SystemAccount[] = ['SYSTEM:DEMO_ISSUER', 'SYSTEM:PRIZES', 'SYSTEM:PAYMENTS', 'SYSTEM:PAYOUT_HOLD', 'SYSTEM:PAYOUTS', 'SYSTEM:ENTRY_FEES', 'SYSTEM:TDS'];
/** At most this share of a paid entry fee may come from bonus money. */
const MAX_BONUS_SHARE = 0.1;
const CHECKOUT_TTL_SECONDS = 15 * 60;

const fromX100 = (n: number) => n / 100;

export interface CheckoutToken {
  tx: string;
  typ: 'checkout';
}

@Injectable()
export class WalletService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider | null,
    private readonly play: ResponsiblePlayService,
    private readonly events: NotificationEvents,
    @InjectEnv() private readonly env: Env,
  ) {}

  /** System accounts are created up front so concurrent postings never race to create them. */
  async onApplicationBootstrap(): Promise<void> {
    for (const currency of ['DEMO', 'INR'] as const) {
      for (const code of SYSTEM_ACCOUNTS) {
        const found = await this.prisma.walletAccount.findFirst({ where: { userId: null, code, currency } });
        if (!found) await this.prisma.walletAccount.create({ data: { code, currency } });
      }
    }
  }

  private get realMoney(): boolean {
    return paidContestsEnabled(this.env) && this.payments !== null;
  }

  // ─── Read side ────────────────────────────────────────────────────────────

  async wallet(userId: string): Promise<WalletDto> {
    if (this.env.APP_MODE === 'demo' && this.env.DEMO_WELCOME_BONUS > 0) {
      await this.ledger.post({
        userId,
        type: 'BONUS',
        status: 'SUCCESS',
        currency: 'DEMO',
        idempotencyKey: `welcome:${userId}`,
        description: 'Welcome bonus (demo credits)',
        lines: [
          { account: 'USER', bucket: 'BONUS', amount: this.env.DEMO_WELCOME_BONUS },
          { account: 'SYSTEM:DEMO_ISSUER', bucket: 'BONUS', amount: -this.env.DEMO_WELCOME_BONUS },
        ],
      });
    }
    const currencies: WalletCurrency[] = this.env.APP_MODE === 'demo' ? ['DEMO'] : ['INR'];
    const balances = await Promise.all(currencies.map((c) => this.balance(userId, c)));
    const kyc = await this.prisma.kycRecord.findUnique({ where: { userId }, select: { status: true } });
    return {
      mode: this.env.APP_MODE,
      primary: currencies[0]!,
      balances,
      depositsEnabled: this.realMoney,
      withdrawalsEnabled: this.realMoney,
      kycStatus: kyc?.status ?? 'NOT_STARTED',
      limits: { minDeposit: DEPOSIT_LIMITS.min, maxDeposit: DEPOSIT_LIMITS.max, minWithdrawal: MIN_WITHDRAWAL },
    };
  }

  async balance(userId: string, currency: WalletCurrency): Promise<BalanceDto> {
    const b = await this.ledger.balances(userId, currency);
    return {
      currency,
      deposited: fromX100(b.DEPOSITED),
      winnings: fromX100(b.WINNINGS),
      bonus: fromX100(b.BONUS),
      total: fromX100(b.DEPOSITED + b.WINNINGS + b.BONUS),
      withdrawable: fromX100(b.WINNINGS),
    };
  }

  async history(userId: string, limit: number, cursor?: string): Promise<{ items: WalletTxDto[]; nextCursor: string | null }> {
    const rows = await this.prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        currency: t.currency,
        // PENDING deposits have no money moved yet; show the requested amount.
        amount: fromX100(t.amountX100 !== 0 ? t.amountX100 : ((t.metadata as { requestedX100?: number } | null)?.requestedX100 ?? 0)),
        description: t.description,
        reference: t.reference,
        createdAt: t.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  // ─── Contests ─────────────────────────────────────────────────────────────

  /** Credits settled winnings, one idempotent transaction per entry. INR only when real money is enabled. */
  async creditWinnings(contestId: string): Promise<number> {
    const contest = await this.prisma.contest.findUniqueOrThrow({ where: { id: contestId }, select: { name: true, currency: true } });
    if (contest.currency === 'NONE') return 0;
    if (contest.currency === 'INR' && !this.realMoney) return 0;
    const currency: WalletCurrency = contest.currency === 'DEMO' ? 'DEMO' : 'INR';
    const winners = await this.prisma.contestEntry.findMany({ where: { contestId, winningsX100: { gt: 0 } }, select: { id: true, userId: true, winningsX100: true, rank: true } });
    let credited = 0;
    for (const w of winners) {
      const amount = fromX100(w.winningsX100);
      const { created } = await this.ledger.post({
        userId: w.userId,
        type: 'CONTEST_WINNING',
        status: 'SUCCESS',
        currency,
        idempotencyKey: `win:${w.id}`,
        reference: contestId,
        description: `Won in ${contest.name} (rank #${w.rank})${currency === 'DEMO' ? ' — demo credits' : ''}`,
        lines: [
          { account: 'USER', bucket: 'WINNINGS', amount },
          { account: currency === 'DEMO' ? 'SYSTEM:DEMO_ISSUER' : 'SYSTEM:PRIZES', bucket: 'WINNINGS', amount: -amount },
        ],
      });
      if (created) credited++;
    }
    return credited;
  }

  /**
   * Debits a paid entry inside the caller's join transaction: bonus (up to 10% of the fee) first,
   * then deposited money, then winnings. Throws if the balance is short — the join rolls back.
   */
  async chargeEntry(tx: Prisma.TransactionClient, userId: string, contest: { id: string; name: string; entryFeeX100: number }, teamIds: string[]): Promise<void> {
    if (!this.realMoney) throw new ForbiddenException('Paid contests are not available');
    await this.ledger.lockUser(tx, userId, 'INR');
    const b = await this.ledger.balances(userId, 'INR', tx);
    const fee = contest.entryFeeX100;
    const need = fee * teamIds.length;
    if (b.DEPOSITED + b.WINNINGS + Math.min(b.BONUS, Math.floor(fee * MAX_BONUS_SHARE) * teamIds.length) < need) {
      throw new BadRequestException(`Not enough balance — you need ₹${fromX100(need)}. Add cash to join.`);
    }
    const left = { BONUS: b.BONUS, DEPOSITED: b.DEPOSITED, WINNINGS: b.WINNINGS };
    for (const teamId of teamIds) {
      let due = fee;
      const take = (bucket: WalletBucket, cap: number) => {
        const amt = Math.min(due, left[bucket], cap);
        left[bucket] -= amt;
        due -= amt;
        return amt;
      };
      const parts: [WalletBucket, number][] = [
        ['BONUS', take('BONUS', Math.floor(fee * MAX_BONUS_SHARE))],
        ['DEPOSITED', take('DEPOSITED', Infinity)],
        ['WINNINGS', take('WINNINGS', Infinity)],
      ];
      const lines: Line[] = parts.filter(([, a]) => a > 0).flatMap(([bucket, a]) => [
        { account: 'USER' as const, bucket, amount: -fromX100(a) },
        { account: 'SYSTEM:ENTRY_FEES' as const, bucket, amount: fromX100(a) },
      ]);
      await this.ledger.post(
        {
          userId,
          type: 'CONTEST_ENTRY',
          status: 'SUCCESS',
          currency: 'INR',
          idempotencyKey: `entry:${contest.id}:${teamId}`,
          reference: contest.id,
          description: `Joined ${contest.name}`,
          lines,
        },
        tx,
      );
    }
  }

  /** Returns entry fees for a cancelled contest to the exact buckets they came from. */
  async refundContest(contestId: string): Promise<number> {
    const charges = await this.prisma.walletTransaction.findMany({
      where: { reference: contestId, type: 'CONTEST_ENTRY', status: 'SUCCESS' },
      include: { entries: { include: { account: { select: { code: true } } } } },
    });
    let refunded = 0;
    for (const c of charges) {
      const lines: Line[] = c.entries.map((e) => ({
        account: e.account.code === 'USER' ? 'USER' : (e.account.code as SystemAccount),
        bucket: e.bucket,
        amount: -fromX100(e.amountX100),
      }));
      const { created } = await this.ledger.post({
        userId: c.userId,
        type: 'REFUND',
        status: 'SUCCESS',
        currency: c.currency,
        idempotencyKey: `refund:${c.id}`,
        reference: contestId,
        description: `Refund — ${c.description.replace(/^Joined /, '')} was cancelled`,
        lines,
      });
      if (created) refunded++;
    }
    return refunded;
  }

  // ─── Deposits ─────────────────────────────────────────────────────────────

  async createDeposit(userId: string, amount: number, meta: RequestMeta): Promise<DepositOrderDto> {
    if (!this.realMoney || !this.payments) {
      throw new ForbiddenException(this.env.APP_MODE === 'demo' ? 'Real-money deposits are switched off in demo mode' : 'Deposits are not available');
    }
    const amountX100 = Math.round(amount * 100);
    await this.play.assertDepositAllowed(userId, amountX100);
    await this.play.assertRealMoneyRegion(userId, meta);
    const receipt = `dep_${userId.slice(-8)}_${Date.now()}`;
    const order = await this.payments.createOrder(amountX100, receipt);
    const { transaction } = await this.ledger.post({
      userId,
      type: 'DEPOSIT',
      status: 'PENDING',
      currency: 'INR',
      idempotencyKey: `dep:${order.orderId}`,
      reference: order.orderId,
      description: 'Add cash',
      metadata: { requestedX100: amountX100, provider: this.payments.name, ip: meta.ip },
      lines: [],
    });
    const token = await this.jwt.signAsync({ tx: transaction.id, typ: 'checkout' } satisfies CheckoutToken, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: CHECKOUT_TTL_SECONDS,
    });
    const base = this.env.PUBLIC_API_URL ?? `http://localhost:${this.env.PORT}`;
    return { transactionId: transaction.id, amount, checkoutUrl: `${base}/pay/${transaction.id}?t=${encodeURIComponent(token)}` };
  }

  async verifyCheckoutToken(token: string): Promise<string> {
    try {
      const p = await this.jwt.verifyAsync<CheckoutToken>(token, { secret: this.env.JWT_ACCESS_SECRET });
      if (p.typ !== 'checkout') throw new Error('wrong token');
      return p.tx;
    } catch {
      throw new ForbiddenException('This payment link has expired. Start again from the app.');
    }
  }

  async checkoutDetails(transactionId: string) {
    const t = await this.prisma.walletTransaction.findUnique({ where: { id: transactionId }, include: { user: { select: { name: true, email: true, phone: true } } } });
    if (!t || t.type !== 'DEPOSIT') throw new NotFoundException('Payment not found');
    return { t, keyId: this.payments?.publicKey ?? '' };
  }

  /** Client-side confirmation from the checkout page: verify the gateway signature, then credit. */
  async confirmFromCheckout(transactionId: string, orderId: string, paymentId: string, signature: string): Promise<'SUCCESS'> {
    if (!this.payments) throw new ForbiddenException('Deposits are not available');
    const t = await this.prisma.walletTransaction.findUnique({ where: { id: transactionId } });
    if (!t || t.reference !== orderId) throw new BadRequestException('Payment does not match this order');
    if (!this.payments.verifyPayment(orderId, paymentId, signature)) throw new BadRequestException('Payment signature is invalid');
    await this.settleDeposit(orderId, paymentId, 'checkout');
    return 'SUCCESS';
  }

  /** Gateway webhook (source of truth). Returns false for an invalid signature. */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<boolean> {
    if (!this.payments) return false;
    const event = this.payments.parseWebhook(rawBody, signature);
    if (!event) return false;
    if (event.orderId && event.paymentId && event.type === 'captured') await this.settleDeposit(event.orderId, event.paymentId, 'webhook');
    if (event.orderId && event.type === 'failed') await this.failDeposit(event.orderId);
    return true;
  }

  /** Idempotent: the checkout and the webhook may both arrive, in any order, any number of times. */
  private async settleDeposit(orderId: string, paymentId: string, source: string): Promise<void> {
    const settled = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string; status: string; metadata: { requestedX100?: number } | null }[]>`
        SELECT id, status, metadata FROM "WalletTransaction" WHERE reference = ${orderId} AND type = 'DEPOSIT' FOR UPDATE`;
      if (!row || row.status === 'SUCCESS') return null;
      const amount = fromX100(row.metadata?.requestedX100 ?? 0);
      await this.ledger.complete(row.id, 'SUCCESS', [
        { account: 'USER', bucket: 'DEPOSITED', amount },
        { account: 'SYSTEM:PAYMENTS', bucket: 'DEPOSITED', amount: -amount },
      ], tx);
      await tx.walletTransaction.update({ where: { id: row.id }, data: { metadata: { ...(row.metadata ?? {}), paymentId, confirmedBy: source } } });
      await this.audit.log({ action: 'wallet.deposit_confirmed', entityType: 'WalletTransaction', entityId: row.id, metadata: { orderId, paymentId, source, amount } }, tx);
      return row.id;
    });
    if (settled) void this.events.transaction(settled).catch(this.events.logError);
  }

  private async failDeposit(orderId: string): Promise<void> {
    const { count } = await this.prisma.walletTransaction.updateMany({ where: { reference: orderId, type: 'DEPOSIT', status: 'PENDING' }, data: { status: 'FAILED' } });
    const t = count ? await this.prisma.walletTransaction.findFirst({ where: { reference: orderId, type: 'DEPOSIT' }, select: { id: true } }) : null;
    if (t) void this.events.transaction(t.id).catch(this.events.logError);
  }

  // ─── Withdrawals ──────────────────────────────────────────────────────────

  /** Holds the amount (winnings → payout hold) pending admin approval. */
  async requestWithdrawal(userId: string, amount: number): Promise<WalletTxDto> {
    if (!this.realMoney) throw new ForbiddenException(this.env.APP_MODE === 'demo' ? 'Withdrawals are switched off in demo mode' : 'Withdrawals are not available');
    const kyc = await this.prisma.kycRecord.findUnique({ where: { userId } });
    if (kyc?.status !== 'VERIFIED') throw new ForbiddenException('Complete KYC verification before withdrawing');

    const t = await this.prisma.$transaction(async (tx) => {
      await this.ledger.lockUser(tx, userId, 'INR');
      const b = await this.ledger.balances(userId, 'INR', tx);
      if (Math.round(amount * 100) > b.WINNINGS) throw new BadRequestException(`You can withdraw up to ₹${fromX100(b.WINNINGS)} (winnings only)`);
      const t = await this.tdsFor(tx, userId, amount);
      const { transaction } = await this.ledger.post(
        {
          userId,
          type: 'WITHDRAWAL',
          status: 'PENDING',
          currency: 'INR',
          idempotencyKey: `wd:${userId}:${Date.now()}`,
          description: t.tds > 0 ? `Withdrawal to bank (awaiting approval) · TDS ₹${t.tds}` : 'Withdrawal to bank (awaiting approval)',
          metadata: { gross: amount, tds: t.tds, payout: t.payout, netWinnings: t.netWinnings, tdsRatePercent: this.env.TDS_RATE_PERCENT },
          lines: [
            { account: 'USER', bucket: 'WINNINGS', amount: -amount },
            { account: 'SYSTEM:PAYOUT_HOLD', bucket: 'WINNINGS', amount: t.payout },
            ...(t.tds > 0 ? [{ account: 'SYSTEM:TDS' as const, bucket: 'WINNINGS' as const, amount: t.tds }] : []),
          ],
        },
        tx,
      );
      return transaction;
    });
    void this.events.transaction(t.id).catch(this.events.logError);
    return (await this.history(userId, 1)).items.find((i) => i.id === t.id) ?? (await this.txDto(t.id));
  }

  /** Admin: money leaves the hold to the payout account. */
  async approveWithdrawal(transactionId: string, adminId: string): Promise<void> {
    await this.resolveWithdrawal(transactionId, adminId, 'SUCCESS');
  }

  /** Admin: money goes back from the hold to the user's winnings. */
  async rejectWithdrawal(transactionId: string, adminId: string, reason: string): Promise<void> {
    await this.resolveWithdrawal(transactionId, adminId, 'FAILED', reason);
  }

  private async resolveWithdrawal(transactionId: string, adminId: string, status: 'SUCCESS' | 'FAILED', reason?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string; status: string; type: string; amountX100: number; metadata: { tds?: number; payout?: number } | null }[]>`
        SELECT id, status, type, "amountX100", metadata FROM "WalletTransaction" WHERE id = ${transactionId} FOR UPDATE`;
      if (!row || row.type !== 'WITHDRAWAL') throw new NotFoundException('Withdrawal not found');
      if (row.status !== 'PENDING') throw new ConflictException('This withdrawal was already processed');
      const amount = fromX100(-row.amountX100);
      // TDS was set aside at request time: approving pays out the rest (TDS stays to be remitted);
      // rejecting returns the full amount, TDS included.
      const tds = row.metadata?.tds ?? 0;
      const payout = row.metadata?.payout ?? amount;
      const lines: Line[] =
        status === 'SUCCESS'
          ? [
              { account: 'SYSTEM:PAYOUT_HOLD', bucket: 'WINNINGS', amount: -payout },
              { account: 'SYSTEM:PAYOUTS', bucket: 'WINNINGS', amount: payout },
            ]
          : [
              { account: 'SYSTEM:PAYOUT_HOLD', bucket: 'WINNINGS', amount: -payout },
              ...(tds > 0 ? [{ account: 'SYSTEM:TDS' as const, bucket: 'WINNINGS' as const, amount: -tds }] : []),
              { account: 'USER', bucket: 'WINNINGS', amount },
            ];
      await this.ledger.complete(transactionId, status, lines, tx);
      await tx.walletTransaction.update({
        where: { id: transactionId },
        data: { description: status === 'SUCCESS' ? (tds > 0 ? `Withdrawal to bank · ₹${payout} paid, TDS ₹${tds}` : 'Withdrawal to bank') : `Withdrawal rejected${reason ? ` — ${reason}` : ''}` },
      });
      await this.audit.log({ action: `wallet.withdrawal_${status === 'SUCCESS' ? 'approved' : 'rejected'}`, actorId: adminId, entityType: 'WalletTransaction', entityId: transactionId, metadata: { amount, reason } }, tx);
    });
    void this.events.transaction(transactionId).catch(this.events.logError);
  }

  /** TDS for a withdrawal, from this financial year's deposits, withdrawals and opening balance. */
  private async tdsFor(tx: Prisma.TransactionClient, userId: string, amount: number) {
    if (this.env.TDS_RATE_PERCENT <= 0) return { netWinnings: 0, tds: 0, payout: amount };
    const fyStart = financialYearStart();
    const inFy = { userId, currency: 'INR' as const, createdAt: { gte: fyStart } };
    const [withdrawals, deposits, opening] = await Promise.all([
      tx.walletTransaction.findMany({ where: { ...inFy, type: 'WITHDRAWAL', status: { in: ['PENDING', 'SUCCESS'] } }, select: { amountX100: true, metadata: true } }),
      tx.walletTransaction.aggregate({ where: { ...inFy, type: 'DEPOSIT', status: 'SUCCESS' }, _sum: { amountX100: true } }),
      tx.ledgerEntry.aggregate({ where: { account: { userId, code: 'USER', currency: 'INR' }, transaction: { createdAt: { lt: fyStart } } }, _sum: { amountX100: true } }),
    ]);
    return computeTds({
      amount,
      fyWithdrawals: withdrawals.reduce((s, w) => s - w.amountX100, 0) / 100,
      fyDeposits: (deposits._sum.amountX100 ?? 0) / 100,
      openingBalance: (opening._sum.amountX100 ?? 0) / 100,
      alreadyTaxed: withdrawals.reduce((s, w) => s + ((w.metadata as { netWinnings?: number } | null)?.netWinnings ?? 0), 0),
      ratePercent: this.env.TDS_RATE_PERCENT,
    });
  }

  // ─── KYC ──────────────────────────────────────────────────────────────────

  async kyc(userId: string): Promise<KycDto> {
    const k = await this.prisma.kycRecord.findUnique({ where: { userId } });
    return { status: k?.status ?? 'NOT_STARTED', fullName: k?.fullName ?? null, panMasked: k?.panMasked ?? null, reviewNote: k?.reviewNote ?? null };
  }

  async submitKyc(userId: string, input: KycInput, meta: RequestMeta): Promise<KycDto> {
    const existing = await this.prisma.kycRecord.findUnique({ where: { userId } });
    if (existing?.status === 'VERIFIED') throw new ConflictException('Your KYC is already verified');
    const panHash = createHash('sha256').update(`${this.env.OTP_SECRET}:${input.pan}`).digest('hex');
    // One PAN, one account — a common multi-accounting signal.
    const clash = await this.prisma.kycRecord.findFirst({ where: { panHash, userId: { not: userId } }, select: { userId: true } });
    if (clash) {
      await this.audit.log({ action: 'kyc.pan_conflict', actorId: userId, entityType: 'User', entityId: clash.userId, metadata: { otherUserId: clash.userId }, meta });
      throw new ConflictException('This PAN is already linked to another account');
    }
    const data = { status: 'PENDING' as const, fullName: input.fullName, panMasked: `${input.pan.slice(0, 2)}XXXXX${input.pan.slice(-3)}`, panHash, reviewNote: null, submittedAt: new Date(), reviewedAt: null };
    await this.prisma.kycRecord.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await this.audit.log({ action: 'kyc.submitted', actorId: userId, meta });
    return this.kyc(userId);
  }

  private async txDto(id: string): Promise<WalletTxDto> {
    const t = await this.prisma.walletTransaction.findUniqueOrThrow({ where: { id } });
    return { id: t.id, type: t.type, status: t.status, currency: t.currency, amount: fromX100(t.amountX100), description: t.description, reference: t.reference, createdAt: t.createdAt.toISOString() };
  }
}
