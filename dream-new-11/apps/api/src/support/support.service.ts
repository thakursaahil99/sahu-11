import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SupportMessage, type SupportTicket } from '@prisma/client';
import { randomInt } from 'node:crypto';
import {
  MAX_OPEN_TICKETS,
  type CreateTicketInput,
  type SupportTicketDetailDto,
  type SupportTicketDto,
  type TicketReplyInput,
} from '@dream11/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { NotificationEvents } from '../notifications/notification-events';
import { PrismaService } from '../prisma/prisma.service';

type TicketWithLast = SupportTicket & { messages: SupportMessage[] };

const toDto = (t: TicketWithLast): SupportTicketDto => ({
  id: t.id,
  reference: t.reference,
  category: t.category,
  subject: t.subject,
  status: t.status,
  lastMessage: t.messages[0]?.body.slice(0, 140) ?? '',
  lastMessageAt: t.lastMessageAt.toISOString(),
  createdAt: t.createdAt.toISOString(),
});

/** User side of help & support. Staff replies and status changes come from the admin panel. */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: NotificationEvents,
  ) {}

  async list(userId: string): Promise<SupportTicketDto[]> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map(toDto);
  }

  async detail(userId: string, id: string): Promise<SupportTicketDetailDto> {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw new NotFoundException('Ticket not found');
    const last = [...t.messages].reverse();
    return {
      ...toDto({ ...t, messages: last }),
      messages: t.messages.map((m) => ({ id: m.id, fromStaff: m.fromStaff, body: m.body, createdAt: m.createdAt.toISOString() })),
    };
  }

  async create(userId: string, input: CreateTicketInput, meta: RequestMeta): Promise<SupportTicketDetailDto> {
    const open = await this.prisma.supportTicket.count({ where: { userId, status: { in: ['OPEN', 'AWAITING_USER'] } } });
    if (open >= MAX_OPEN_TICKETS) throw new ConflictException(`You have ${open} open requests. Please wait for a reply before opening another.`);

    for (let attempt = 0; ; attempt++) {
      try {
        const t = await this.prisma.supportTicket.create({
          data: {
            userId,
            reference: `DN-${randomInt(10_000, 99_999)}${attempt > 2 ? randomInt(10) : ''}`,
            category: input.category,
            subject: input.subject,
            messages: { create: { body: input.message } },
          },
        });
        await this.audit.log({ action: 'support.ticket_created', actorId: userId, entityType: 'SupportTicket', entityId: t.id, meta });
        return this.detail(userId, t.id);
      } catch (err) {
        // Reference collision — try another one.
        if (attempt < 5 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }

  /** User reply; reopens a resolved ticket. Closed tickets need a new request. */
  async reply(userId: string, id: string, input: TicketReplyInput): Promise<SupportTicketDetailDto> {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId }, select: { id: true, status: true } });
    if (!t) throw new NotFoundException('Ticket not found');
    if (t.status === 'CLOSED') throw new ConflictException('This request is closed. Please open a new one.');
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, body: input.message } }),
      this.prisma.supportTicket.update({ where: { id }, data: { status: 'OPEN', lastMessageAt: new Date() } }),
    ]);
    return this.detail(userId, id);
  }

  /** Staff reply (admin panel, Phase 8). */
  async staffReply(staffId: string, id: string, body: string, status: 'AWAITING_USER' | 'RESOLVED' = 'AWAITING_USER'): Promise<void> {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, select: { userId: true, reference: true } });
    if (!t) throw new NotFoundException('Ticket not found');
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, body, staffId, fromStaff: true } }),
      this.prisma.supportTicket.update({ where: { id }, data: { status, lastMessageAt: new Date() } }),
    ]);
    await this.audit.log({ action: 'support.staff_reply', actorId: staffId, entityType: 'SupportTicket', entityId: id });
    void this.events.supportReplied(t.userId, id, t.reference).catch(this.events.logError);
  }
}
