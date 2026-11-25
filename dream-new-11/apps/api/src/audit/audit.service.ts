import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestMeta } from '../common/request-meta';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  meta?: RequestMeta;
}

/** Append-only audit trail. Failures are logged, never thrown, so they cannot break user flows. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId ?? null,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: entry.metadata,
          ip: entry.meta?.ip,
          userAgent: entry.meta?.userAgent,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log "${entry.action}"`, err instanceof Error ? err.stack : err);
    }
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
