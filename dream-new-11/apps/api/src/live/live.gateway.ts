import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { LIVE_NAMESPACE, userRoom } from '@dream11/shared';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard';
import { Env, InjectEnv } from '../config/config.module';
import { paidContestsEnabled } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const ROOM = /^(contest|match):[a-z0-9]{10,40}$/;

interface SocketData {
  userId: string;
}

/**
 * Real-time channel. Clients connect with `auth: { token }` (the access token), then emit
 * `subscribe` with a room name: `match:<id>` or `contest:<id>`. Auth is per connection and
 * every subscription is access-checked (private contests need membership). Each connection also
 * joins its private `user:<id>` room for notifications.
 * For several API instances, add the Socket.IO Redis adapter (see docs/DEPLOYMENT.md).
 */
@WebSocketGateway({ namespace: LIVE_NAMESPACE, cors: { origin: true, credentials: false } })
export class LiveGateway implements OnGatewayConnection {
  private readonly logger = new Logger(LiveGateway.name);

  @WebSocketServer() server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @InjectEnv() private readonly env: Env,
    notifications: NotificationsService,
  ) {
    notifications.attachRealtime((room, event, payload) => this.emit(room, event, payload));
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    try {
      if (typeof token !== 'string') throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.env.JWT_ACCESS_SECRET });
      if (payload.typ !== 'access') throw new Error('wrong token type');
      (client.data as SocketData).userId = payload.sub;
      await client.join(userRoom(payload.sub));
    } catch {
      client.emit('error', { message: 'Session expired. Please log in again.' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { room?: unknown }): Promise<{ ok: boolean; error?: string }> {
    const room = typeof body?.room === 'string' ? body.room : '';
    if (!ROOM.test(room)) return { ok: false, error: 'Unknown room' };
    const userId = (client.data as SocketData).userId;
    if (!(await this.canJoin(userId, room))) return { ok: false, error: 'Not allowed' };
    await client.join(room);
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { room?: unknown }): Promise<{ ok: boolean }> {
    if (typeof body?.room === 'string') await client.leave(body.room);
    return { ok: true };
  }

  emit(room: string, event: string, payload: unknown): void {
    this.server?.to(room).emit(event, payload);
  }

  private async canJoin(userId: string, room: string): Promise<boolean> {
    const [kind, id] = room.split(':') as ['contest' | 'match', string];
    if (kind === 'match') return !!(await this.prisma.match.findFirst({ where: { id, sport: { enabled: true } }, select: { id: true } }));
    const c = await this.prisma.contest.findUnique({ where: { id }, select: { type: true, createdById: true, entryFeeX100: true } });
    if (!c) return false;
    if (c.createdById === userId) return true;
    if (c.type === 'PRIVATE' || (c.entryFeeX100 > 0 && !paidContestsEnabled(this.env))) {
      const mine = await this.prisma.contestEntry.count({ where: { contestId: id, userId } });
      if (mine === 0) this.logger.debug(`Denied ${userId} → ${room}`);
      return mine > 0;
    }
    return true;
  }
}
