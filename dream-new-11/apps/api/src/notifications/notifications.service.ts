import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Notification, type NotificationType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { USER_EVENTS, userRoom, type MarkReadInput, type NotificationDto, type NotificationPageDto, type PushTokenInput } from '@dream11/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, type PushProvider } from './push.provider';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  url?: string | null;
  /** Same key for the same user → stored and sent once. */
  dedupeKey?: string | null;
}

export interface NotifyOptions {
  /** Marketing-style messages are pushed only to users who opted in to promotions. */
  promotional?: boolean;
}

type Realtime = (room: string, event: string, payload: unknown) => void;

/** Which user setting gates push for each type. Types not listed always push. */
const PUSH_PREF: Partial<Record<NotificationType, 'pushMatchReminders' | 'pushContestUpdates'>> = {
  MATCH_REMINDER: 'pushMatchReminders',
  MATCH_START: 'pushMatchReminders',
  CONTEST_JOINED: 'pushContestUpdates',
  CONTEST_RESULT: 'pushContestUpdates',
  CONTEST_CANCELLED: 'pushContestUpdates',
};

export const toNotificationDto = (n: Notification): NotificationDto => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  url: n.url,
  read: n.readAt !== null,
  createdAt: n.createdAt.toISOString(),
});

/**
 * Every notification is stored first (the in-app centre is the source of truth), then pushed
 * over Socket.IO to open apps and via the push provider to devices. Delivery runs in the
 * background so callers never wait on, or fail because of, a push service.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private realtime: Realtime | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  /** The Socket.IO gateway registers itself here (avoids a module cycle). */
  attachRealtime(fn: Realtime): void {
    this.realtime = fn;
  }

  async notify(n: NewNotification): Promise<NotificationDto | null> {
    return (await this.notifyMany([n]))[0] ?? null;
  }

  /** Inserts in one statement; rows whose (user, dedupeKey) already exists are skipped. */
  async notifyMany(list: NewNotification[], opts: NotifyOptions = {}): Promise<NotificationDto[]> {
    if (!list.length) return [];
    const created: Notification[] = [];
    for (let i = 0; i < list.length; i += 1000) {
      const batch = list.slice(i, i + 1000);
      const rows = await this.prisma.$queryRaw<Notification[]>`
        INSERT INTO "Notification" (id, "userId", type, title, body, url, "dedupeKey", "createdAt")
        -- Columns are UTC "timestamp without time zone"; the DB session may be in another zone.
        SELECT *, now() AT TIME ZONE 'UTC' FROM unnest(
          ${batch.map(() => randomUUID())}::text[],
          ${batch.map((n) => n.userId)}::text[],
          ${batch.map((n) => n.type)}::"NotificationType"[],
          ${batch.map((n) => n.title)}::text[],
          ${batch.map((n) => n.body)}::text[],
          ${batch.map((n) => n.url ?? null)}::text[],
          ${batch.map((n) => n.dedupeKey ?? null)}::text[]
        )
        ON CONFLICT ("userId", "dedupeKey") DO NOTHING
        RETURNING *`;
      created.push(...rows);
    }
    const dtos = created.map(toNotificationDto);
    if (created.length) {
      void this.deliver(created, opts.promotional ?? false).catch((err) => this.logger.error(`Delivery failed: ${err instanceof Error ? err.stack : String(err)}`));
    }
    return dtos;
  }

  private async deliver(rows: Notification[], promotional: boolean): Promise<void> {
    for (const n of rows) this.realtime?.(userRoom(n.userId), USER_EVENTS.notification, toNotificationDto(n));

    const userIds = [...new Set(rows.map((n) => n.userId))];
    const [tokens, settings] = await Promise.all([
      this.prisma.pushToken.findMany({ where: { userId: { in: userIds } }, select: { userId: true, token: true, kind: true } }),
      this.prisma.userSettings.findMany({ where: { userId: { in: userIds } } }),
    ]);
    if (!tokens.length) return;
    const prefs = new Map(settings.map((s) => [s.userId, s]));
    const byUser = new Map<string, typeof tokens>();
    for (const t of tokens) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t]);

    const dead = new Set<string>();
    for (const n of rows) {
      const targets = byUser.get(n.userId);
      if (!targets?.length) continue;
      const s = prefs.get(n.userId);
      const pref = PUSH_PREF[n.type];
      if (s && pref && !s[pref]) continue;
      if (promotional && !s?.pushPromotions) continue;
      const { invalid } = await this.push.send(targets, { title: n.title, body: n.body, data: { notificationId: n.id, type: n.type, ...(n.url ? { url: n.url } : {}) } });
      invalid.forEach((t) => dead.add(t));
    }
    if (dead.size) await this.prisma.pushToken.deleteMany({ where: { token: { in: [...dead] } } });
  }

  // ─── Notification centre ──────────────────────────────────────────────────

  async list(userId: string, limit: number, cursor?: string): Promise<NotificationPageDto> {
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.unreadCount(userId),
    ]);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items: items.map(toNotificationDto), nextCursor: more ? items[items.length - 1]!.id : null, unread };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, input: MarkReadInput): Promise<{ unread: number }> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...('ids' in input ? { id: { in: input.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { unread: await this.unreadCount(userId) };
  }

  // ─── Devices ──────────────────────────────────────────────────────────────

  /** A device belongs to whoever registered it last (shared phones, account switches). */
  async registerToken(userId: string, input: PushTokenInput): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token: input.token },
      create: { userId, ...input },
      update: { userId, kind: input.kind, platform: input.platform, lastSeenAt: new Date() },
    });
  }

  async removeToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  /** Fan-out to many users (announcements). Uses a set-based insert. */
  async broadcast(where: Prisma.UserWhereInput, n: Omit<NewNotification, 'userId'>, opts: NotifyOptions = {}): Promise<number> {
    let sent = 0;
    let cursor: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { ...where, deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 1000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!users.length) break;
      sent += (await this.notifyMany(users.map((u) => ({ ...n, userId: u.id })), opts)).length;
      cursor = users[users.length - 1]!.id;
    }
    return sent;
  }
}
