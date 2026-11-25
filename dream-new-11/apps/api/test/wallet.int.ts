/**
 * Wallet integration test against the real database with real-money mode switched on in-process
 * and a stubbed gateway (real HMAC signature checks, no network). Covers deposits, idempotency,
 * paid entries, refunds, KYC, withdrawals and ledger invariants.
 *
 *   npm run test:int -w @dream11/api
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { depositLimitsSchema } from '@dream11/shared';
import { AuditService } from '../src/audit/audit.service';
import { loadEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { LedgerService } from '../src/wallet/ledger.service';
import { PaymentOrder, RazorpayProvider } from '../src/wallet/payment-provider';
import { WalletService } from '../src/wallet/wallet.service';
import { NotificationEvents } from '../src/notifications/notification-events';
import { NotificationsService } from '../src/notifications/notifications.service';
import { LogPushProvider } from '../src/notifications/push.provider';
import { ResponsiblePlayService } from '../src/responsible-play/responsible-play.service';

const SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';

/** Real Razorpay signature logic; only order creation is stubbed. */
class StubRazorpay extends RazorpayProvider {
  private n = 0;
  constructor() {
    super('rzp_test_key', SECRET, WEBHOOK_SECRET);
  }
  override async createOrder(amountPaise: number): Promise<PaymentOrder> {
    return { orderId: `order_test_${Date.now()}_${++this.n}`, amount: amountPaise, currency: 'INR' };
  }
}

const sign = (orderId: string, paymentId: string) => createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const webhook = (orderId: string, paymentId: string, event = 'payment.captured') => {
  const raw = Buffer.from(JSON.stringify({ event, payload: { payment: { entity: { id: paymentId, order_id: orderId } } } }));
  return { raw, sig: createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex') };
};

let pass = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  assert.ok(cond, `${name} ${extra}`);
  pass++;
  console.log(`PASS  ${name}`);
};
const rejects = async (p: Promise<unknown>, re: RegExp) => {
  try {
    await p;
    return false;
  } catch (e) {
    return re.test((e as Error).message);
  }
};

const env = { ...loadEnv(), APP_MODE: 'production' as const, ENABLE_PAID_CONTESTS: true, REAL_MONEY_COMPLIANCE_ACK: true, PUBLIC_API_URL: 'https://api.test' };
const prisma = new PrismaService();
const audit = new AuditService(prisma);
const ledger = new LedgerService(prisma, audit);
const notifications = new NotificationsService(prisma, new LogPushProvider());
const events = new NotificationEvents(prisma, notifications, env);
const play = new ResponsiblePlayService(prisma, audit, env);
const wallet = new WalletService(prisma, ledger, audit, new JwtService(), new StubRazorpay(), play, events, env);
const meta = { ip: '127.0.0.1', userAgent: 'wallet-int' };
const users: string[] = [];

async function newUser(tag: string, state: string | null = 'MH') {
  const u = await prisma.user.create({ data: { name: `Wallet ${tag}`, dob: new Date('1990-01-01'), referralCode: `WINT${Date.now()}${tag}`, termsAcceptedAt: new Date(), state } });
  users.push(u.id);
  return u.id;
}
const inr = (userId: string) => wallet.balance(userId, 'INR');

async function deposit(userId: string, amount: number) {
  const d = await wallet.createDeposit(userId, amount, meta);
  const t = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: d.transactionId } });
  return { ...d, orderId: t.reference! };
}

async function main() {
  await prisma.$connect();
  await wallet.onApplicationBootstrap();
  const a = await newUser('A');

  // ── Deposits ──
  const d1 = await deposit(a, 500);
  ok('deposit creates a PENDING order and a checkout link', d1.checkoutUrl.startsWith('https://api.test/pay/') && (await inr(a)).total === 0);
  ok('checkout token round-trips', (await wallet.verifyCheckoutToken(new URL(d1.checkoutUrl).searchParams.get('t')!)) === d1.transactionId);
  ok('bad signature is refused and credits nothing', (await rejects(wallet.confirmFromCheckout(d1.transactionId, d1.orderId, 'pay_1', 'f'.repeat(64)), /signature/)) && (await inr(a)).total === 0);
  await wallet.confirmFromCheckout(d1.transactionId, d1.orderId, 'pay_1', sign(d1.orderId, 'pay_1'));
  ok('valid checkout credits deposited balance', (await inr(a)).deposited === 500);
  const w1 = webhook(d1.orderId, 'pay_1');
  ok('valid webhook accepted', await wallet.handleWebhook(w1.raw, w1.sig));
  await wallet.handleWebhook(w1.raw, w1.sig);
  ok('duplicate webhook + checkout credit only once', (await inr(a)).deposited === 500);
  ok('forged webhook rejected', !(await wallet.handleWebhook(w1.raw, '0'.repeat(64))));

  const d2 = await deposit(a, 250);
  const w2 = webhook(d2.orderId, 'pay_2');
  await Promise.all([
    wallet.confirmFromCheckout(d2.transactionId, d2.orderId, 'pay_2', sign(d2.orderId, 'pay_2')),
    wallet.handleWebhook(w2.raw, w2.sig),
    wallet.handleWebhook(w2.raw, w2.sig),
  ]);
  ok('concurrent checkout + 2 webhooks credit exactly once', (await inr(a)).deposited === 750);

  const d3 = await deposit(a, 100);
  const w3 = webhook(d3.orderId, 'pay_3', 'payment.failed');
  await wallet.handleWebhook(w3.raw, w3.sig);
  const failed = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: d3.transactionId } });
  ok('failed payment marks the deposit FAILED, no credit', failed.status === 'FAILED' && (await inr(a)).deposited === 750);

  // ── Paid entries + refunds ──
  await ledger.post({
    userId: a,
    type: 'BONUS',
    status: 'SUCCESS',
    currency: 'INR',
    idempotencyKey: `test-bonus:${a}`,
    description: 'Test bonus',
    lines: [
      { account: 'USER', bucket: 'BONUS', amount: 20 },
      { account: 'SYSTEM:PAYMENTS', bucket: 'BONUS', amount: -20 },
    ],
  });
  const contest = { id: `contest_test_${Date.now()}`, name: 'Test ₹49 Contest', entryFeeX100: 4900 };
  await prisma.$transaction((tx) => wallet.chargeEntry(tx, a, contest, ['team1', 'team2']));
  const afterEntry = await inr(a);
  ok('entry fee: bonus covers at most 10% per entry', afterEntry.bonus === 20 - 9.8 && afterEntry.deposited === 750 - (98 - 9.8));

  const poor = await newUser('P');
  const before = await prisma.ledgerEntry.count();
  ok('insufficient balance refuses the entry', await rejects(prisma.$transaction((tx) => wallet.chargeEntry(tx, poor, contest, ['t'])), /Not enough balance/));
  ok('…and writes nothing to the ledger', (await prisma.ledgerEntry.count()) === before);

  await wallet.refundContest(contest.id);
  const refunded = await inr(a);
  ok('refund restores every bucket exactly', refunded.bonus === 20 && refunded.deposited === 750);
  await wallet.refundContest(contest.id);
  ok('refund is idempotent', (await inr(a)).total === refunded.total);

  // ── KYC + withdrawals ──
  ok('withdrawal needs verified KYC', await rejects(wallet.requestWithdrawal(a, 100), /KYC/));
  const pan = `ABCDE${String(Date.now()).slice(-4)}F`;
  const k = await wallet.submitKyc(a, { fullName: 'Wallet A', pan }, meta);
  ok('KYC stored masked and pending', k.status === 'PENDING' && k.panMasked === `${pan.slice(0, 2)}XXXXX${pan.slice(-3)}`);
  const b = await newUser('B');
  ok('same PAN on another account is refused', await rejects(wallet.submitKyc(b, { fullName: 'Wallet B', pan }, meta), /already linked/));
  await prisma.kycRecord.update({ where: { userId: a }, data: { status: 'VERIFIED' } });

  ok('deposited money is not withdrawable', await rejects(wallet.requestWithdrawal(a, 100), /up to ₹0/));
  await ledger.post({
    userId: a,
    type: 'CONTEST_WINNING',
    status: 'SUCCESS',
    currency: 'INR',
    idempotencyKey: `test-win:${a}`,
    description: 'Test winnings',
    lines: [
      { account: 'USER', bucket: 'WINNINGS', amount: 300 },
      { account: 'SYSTEM:PRIZES', bucket: 'WINNINGS', amount: -300 },
    ],
  });
  const wd1 = await wallet.requestWithdrawal(a, 200);
  ok('withdrawal holds the amount (PENDING)', wd1.status === 'PENDING' && (await inr(a)).winnings === 100);

  const race = await Promise.allSettled([wallet.requestWithdrawal(a, 100), wallet.requestWithdrawal(a, 100)]);
  ok('two concurrent withdrawals of the last ₹100: exactly one succeeds', race.filter((r) => r.status === 'fulfilled').length === 1 && (await inr(a)).winnings === 0);
  const wd2 = (race.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value;

  await wallet.rejectWithdrawal(wd2.id, a, 'Bank details mismatch');
  ok('rejected withdrawal returns to winnings', (await inr(a)).winnings === 100);
  await wallet.approveWithdrawal(wd1.id, a);
  const approved = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: wd1.id } });
  ok('approved withdrawal is SUCCESS and stays deducted', approved.status === 'SUCCESS' && (await inr(a)).winnings === 100);
  ok('a withdrawal cannot be processed twice', await rejects(wallet.approveWithdrawal(wd1.id, a), /already processed/));

  // ── Ledger invariants ──
  const unbalanced = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (SELECT "transactionId", sum("amountX100") s FROM "LedgerEntry" GROUP BY 1 HAVING sum("amountX100") <> 0) x`;
  ok('every transaction in the ledger sums to zero', unbalanced[0]!.n === 0);
  const any = await prisma.ledgerEntry.findFirstOrThrow({ where: { transaction: { userId: a } } });
  ok('ledger lines are append-only (UPDATE blocked by trigger)', await rejects(prisma.ledgerEntry.update({ where: { id: any.id }, data: { amountX100: 1 } }), /append-only/));

  // ── Geo-blocking (real money only) ──
  const noState = await newUser('NS', null);
  ok('real money needs a declared state', await rejects(wallet.createDeposit(noState, 100, meta), /state of residence/));
  const tg = await newUser('TG', 'TG');
  ok('restricted state can’t deposit', await rejects(wallet.createDeposit(tg, 100, meta), /isn’t available in Telangana/));
  ok('outside India is refused (CDN country header)', await rejects(wallet.createDeposit(a, 100, { ...meta, country: 'US' }), /only available in India/));

  // ── TDS (s.194BA) ──
  const tx = await newUser('TX');
  await prisma.kycRecord.create({ data: { userId: tx, status: 'VERIFIED', fullName: 'Wallet TX', panMasked: 'TXXXXXX1Z', panHash: `tds-${Date.now()}` } });
  const dt = await deposit(tx, 1000);
  await wallet.confirmFromCheckout(dt.transactionId, dt.orderId, 'pay_tds', sign(dt.orderId, 'pay_tds'));
  await ledger.post({
    userId: tx,
    type: 'CONTEST_WINNING',
    status: 'SUCCESS',
    currency: 'INR',
    idempotencyKey: `test-win:${tx}`,
    description: 'Test winnings',
    lines: [
      { account: 'USER', bucket: 'WINNINGS', amount: 3000 },
      { account: 'SYSTEM:PRIZES', bucket: 'WINNINGS', amount: -3000 },
    ],
  });
  const tw1 = await wallet.requestWithdrawal(tx, 3000);
  const m1 = (await prisma.walletTransaction.findUniqueOrThrow({ where: { id: tw1.id } })).metadata as { tds: number; payout: number; netWinnings: number };
  ok('TDS: 30% of net winnings (3,000 out − 1,000 in) is held back', m1.netWinnings === 2000 && m1.tds === 600 && m1.payout === 2400, JSON.stringify(m1));
  await wallet.rejectWithdrawal(tw1.id, a, 'Bank details mismatch');
  ok('rejecting returns the full amount, TDS included', (await inr(tx)).winnings === 3000);
  const tw2 = await wallet.requestWithdrawal(tx, 2000);
  const m2 = (await prisma.walletTransaction.findUniqueOrThrow({ where: { id: tw2.id } })).metadata as { tds: number; netWinnings: number };
  ok('a rejected withdrawal doesn’t count towards the year', m2.netWinnings === 1000 && m2.tds === 300, JSON.stringify(m2));
  await wallet.approveWithdrawal(tw2.id, a);
  const tw3 = await wallet.requestWithdrawal(tx, 1000);
  const m3 = (await prisma.walletTransaction.findUniqueOrThrow({ where: { id: tw3.id } })).metadata as { tds: number; netWinnings: number };
  ok('winnings already taxed this year aren’t taxed again', m3.netWinnings === 1000 && m3.tds === 300, JSON.stringify(m3));
  const tdsAccount = await prisma.ledgerEntry.aggregate({ where: { transaction: { userId: tx }, account: { code: 'SYSTEM:TDS' } }, _sum: { amountX100: true } });
  ok('TDS account holds exactly what was withheld (300 + 300)', tdsAccount._sum.amountX100 === 60000, String(tdsAccount._sum.amountX100));

  // ── Notifications for money movements (delivered in the background) ──
  await new Promise((r) => setTimeout(r, 500));
  const txNotes = await prisma.notification.findMany({ where: { userId: a, type: 'TRANSACTION' } });
  ok('one "added to your wallet" notification per deposit, despite duplicate confirmations', txNotes.filter((n) => n.dedupeKey === `tx:${d1.transactionId}:SUCCESS`).length === 1 && txNotes.filter((n) => n.dedupeKey === `tx:${d2.transactionId}:SUCCESS`).length === 1);
  ok('failed payment notified', txNotes.some((n) => n.dedupeKey === `tx:${d3.transactionId}:FAILED` && n.title === 'Payment failed'));

  // ── Responsible play: deposit limits ──
  const p = await newUser('P');
  await play.setLimits(p, { daily: 500, weekly: null, monthly: null }, meta);
  ok('a new limit applies immediately', (await play.get(p)).limits.daily === 500);
  const p1 = await deposit(p, 400);
  ok('deposit under the limit is allowed', !!p1.transactionId);
  ok('a pending order counts towards the limit', await rejects(deposit(p, 200), /add up to ₹100/));
  await play.setLimits(p, { daily: 1000, weekly: null, monthly: null }, meta);
  const raised = await play.get(p);
  ok('raising a limit waits for the cooling-off period', raised.limits.daily === 500 && raised.pending?.daily === 1000 && !!raised.pendingEffectiveAt);
  ok('…and the old limit still applies meanwhile', await rejects(deposit(p, 200), /daily deposit limit/));
  await prisma.playLimits.update({ where: { userId: p }, data: { pendingEffectiveAt: new Date(Date.now() - 1000) } });
  ok('the raise applies once the cooling-off has passed', (await play.get(p)).limits.daily === 1000 && (await play.get(p)).pending === null);
  await play.setLimits(p, { daily: 300, weekly: null, monthly: null }, meta);
  ok('lowering applies immediately', (await play.get(p)).limits.daily === 300);
  ok('daily above weekly is rejected by the shared schema', !depositLimitsSchema.safeParse({ daily: 1000, weekly: 500, monthly: null }).success);

  // ── Responsible play: take a break ──
  await play.takeBreak(p, 7, meta);
  const onBreak = await play.get(p);
  ok('take a break sets status and end date', onBreak.status === 'ON_BREAK' && !!onBreak.excludedUntil);
  ok('no deposits or play during a break', (await rejects(deposit(p, 100), /on a break/)) && (await rejects(play.assertCanPlay(p), /on a break/)));
  ok('a break cannot be shortened', await rejects(play.takeBreak(p, 1, meta), /longer break/));
  await prisma.playLimits.update({ where: { userId: p }, data: { excludedUntil: new Date(Date.now() - 1000) } });
  await play.assertCanPlay(p);
  ok('play resumes automatically after the break', (await prisma.user.findUniqueOrThrow({ where: { id: p } })).status === 'ACTIVE');

  console.log(`\n${pass} passed, 0 failed`);
}

main()
  .catch((err) => {
    console.error('FAIL ', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Users with ledger history cannot be deleted (financial records are kept); tests clean up their own transactions first.
    if (users.length) {
      await prisma.walletTransaction.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    await prisma.$disconnect();
  });
