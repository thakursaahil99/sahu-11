import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma, TxStatus, TxType, WalletBucket, WalletCurrency, WalletTransaction } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export type SystemAccount = 'SYSTEM:DEMO_ISSUER' | 'SYSTEM:PRIZES' | 'SYSTEM:PAYMENTS' | 'SYSTEM:PAYOUT_HOLD' | 'SYSTEM:PAYOUTS' | 'SYSTEM:ENTRY_FEES' | 'SYSTEM:TDS';

export interface Line {
  /** "USER" for the transaction's user, otherwise a system account. */
  account: 'USER' | SystemAccount;
  bucket: WalletBucket;
  /** Signed rupees / credits (not ×100). */
  amount: number;
}

export interface PostInput {
  userId: string;
  type: TxType;
  status: TxStatus;
  currency: WalletCurrency;
  /** Unique per real-world event; posting the same key twice returns the first transaction. */
  idempotencyKey: string;
  reference?: string;
  description: string;
  metadata?: Prisma.InputJsonObject;
  /** Must sum to zero (double entry). Omit for a PENDING transaction with no money moved yet. */
  lines: Line[];
}

const x100 = (n: number) => Math.round(n * 100);

/**
 * The only way money moves. Every transaction is a set of ledger lines that sum to zero,
 * keyed by an idempotency key so retries and duplicate webhooks can never double-book.
 * Balances are always computed from the lines; nothing ever edits a balance.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Books a transaction. Pass `tx` to join an outer database transaction. */
  async post(input: PostInput, tx?: Prisma.TransactionClient): Promise<{ transaction: WalletTransaction; created: boolean }> {
    const run = async (db: Prisma.TransactionClient) => {
      const existing = await db.walletTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { transaction: existing, created: false };

      const lines = input.lines.map((l) => ({ ...l, amountX100: x100(l.amount) }));
      const sum = lines.reduce((s, l) => s + l.amountX100, 0);
      if (sum !== 0) throw new InternalServerErrorException(`Unbalanced ledger posting (${input.type}: ${sum})`);

      const userDelta = lines.filter((l) => l.account === 'USER').reduce((s, l) => s + l.amountX100, 0);
      const transaction = await db.walletTransaction.create({
        data: {
          userId: input.userId,
          type: input.type,
          status: input.status,
          currency: input.currency,
          amountX100: userDelta,
          idempotencyKey: input.idempotencyKey,
          reference: input.reference,
          description: input.description,
          metadata: input.metadata,
        },
      });
      for (const l of lines) {
        const accountId = l.account === 'USER' ? await this.userAccount(db, input.userId, input.currency) : await this.systemAccount(db, l.account, input.currency);
        await db.ledgerEntry.create({ data: { transactionId: transaction.id, accountId, bucket: l.bucket, amountX100: l.amountX100 } });
      }
      await this.audit.log(
        {
          action: `wallet.${input.type.toLowerCase()}`,
          actorId: input.userId,
          entityType: 'WalletTransaction',
          entityId: transaction.id,
          metadata: { currency: input.currency, amount: userDelta / 100, status: input.status, key: input.idempotencyKey },
        },
        db,
      );
      return { transaction, created: true };
    };

    if (tx) return run(tx);
    try {
      return await this.prisma.$transaction(run);
    } catch (err) {
      // Two concurrent posts with the same key: the loser hits the unique index — return the winner.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const transaction = await this.prisma.walletTransaction.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
        return { transaction, created: false };
      }
      throw err;
    }
  }

  /** Adds lines to an existing (e.g. PENDING) transaction and sets its final status, atomically. */
  async complete(transactionId: string, status: TxStatus, lines: Line[], tx: Prisma.TransactionClient): Promise<WalletTransaction> {
    const t = await tx.walletTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    const mapped = lines.map((l) => ({ ...l, amountX100: x100(l.amount) }));
    if (mapped.reduce((s, l) => s + l.amountX100, 0) !== 0) throw new InternalServerErrorException('Unbalanced ledger completion');
    for (const l of mapped) {
      const accountId = l.account === 'USER' ? await this.userAccount(tx, t.userId, t.currency) : await this.systemAccount(tx, l.account, t.currency);
      await tx.ledgerEntry.create({ data: { transactionId, accountId, bucket: l.bucket, amountX100: l.amountX100 } });
    }
    const userDelta = mapped.filter((l) => l.account === 'USER').reduce((s, l) => s + l.amountX100, 0);
    return tx.walletTransaction.update({ where: { id: transactionId }, data: { status, amountX100: { increment: userDelta } } });
  }

  /** Per-bucket balances (×100) of a user's account in one currency. */
  async balances(userId: string, currency: WalletCurrency, db: Prisma.TransactionClient = this.prisma): Promise<Record<WalletBucket, number>> {
    const rows = await db.ledgerEntry.groupBy({
      by: ['bucket'],
      where: { account: { userId, code: 'USER', currency } },
      _sum: { amountX100: true },
    });
    const out: Record<WalletBucket, number> = { DEPOSITED: 0, WINNINGS: 0, BONUS: 0 };
    for (const r of rows) out[r.bucket] = r._sum.amountX100 ?? 0;
    return out;
  }

  /** Serialises money movements for one user (row lock on their account). */
  async lockUser(tx: Prisma.TransactionClient, userId: string, currency: WalletCurrency): Promise<void> {
    const id = await this.userAccount(tx, userId, currency);
    await tx.$queryRaw`SELECT id FROM "WalletAccount" WHERE id = ${id} FOR UPDATE`;
  }

  private async userAccount(db: Prisma.TransactionClient, userId: string, currency: WalletCurrency): Promise<string> {
    const found = await db.walletAccount.findUnique({ where: { userId_code_currency: { userId, code: 'USER', currency } }, select: { id: true } });
    if (found) return found.id;
    const created = await db.walletAccount.upsert({
      where: { userId_code_currency: { userId, code: 'USER', currency } },
      create: { userId, code: 'USER', currency },
      update: {},
      select: { id: true },
    });
    return created.id;
  }

  private async systemAccount(db: Prisma.TransactionClient, code: SystemAccount, currency: WalletCurrency): Promise<string> {
    // System accounts have userId = null; a NULL never collides in the unique index, so look up first.
    const found = await db.walletAccount.findFirst({ where: { userId: null, code, currency }, select: { id: true } });
    if (found) return found.id;
    return (await db.walletAccount.create({ data: { code, currency }, select: { id: true } })).id;
  }
}
