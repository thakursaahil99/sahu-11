import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { UserDto, updateProfileSchema, updateSettingsSchema } from '@dream11/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { forgetUserStatus } from '../auth/jwt-auth.guard';
import type { RequestMeta } from '../common/request-meta';
import { Env, InjectEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { toUserDto, userInclude } from './user.mapper';

type UpdateProfile = z.output<typeof updateProfileSchema>;
type UpdateSettings = z.output<typeof updateSettingsSchema>;

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_PUBLIC_PREFIX = '/uploads/avatars/';

/** Detects the real image type from magic bytes; the client-sent mimetype is not trusted. */
function sniffImage(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

@Injectable()
export class UsersService {
  private readonly avatarDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
    @InjectEnv() env: Env,
  ) {
    this.avatarDir = resolve(env.UPLOAD_DIR, 'avatars');
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: userInclude });
    if (!user) throw new NotFoundException('Account not found');
    return toUserDto(user);
  }

  async updateProfile(userId: string, input: UpdateProfile, meta: RequestMeta): Promise<UserDto> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: input, include: userInclude });
    await this.audit.log({ action: 'user.profile_updated', actorId: userId, metadata: { fields: Object.keys(input) }, meta });
    return toUserDto(user);
  }

  async updateSettings(userId: string, input: UpdateSettings): Promise<UserDto> {
    await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
    return this.me(userId);
  }

  async setAvatar(userId: string, file: Express.Multer.File | undefined, meta: RequestMeta): Promise<UserDto> {
    if (!file) throw new BadRequestException('Choose an image to upload');
    const ext = sniffImage(file.buffer);
    if (!ext) throw new BadRequestException('Only JPG, PNG or WEBP images are allowed');

    await mkdir(this.avatarDir, { recursive: true });
    const filename = `${userId}-${randomBytes(6).toString('hex')}.${ext}`;
    await writeFile(join(this.avatarDir, filename), file.buffer);

    const previous = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: AVATAR_PUBLIC_PREFIX + filename },
      include: userInclude,
    });
    await this.removeLocalAvatar(previous?.avatarUrl ?? null);
    await this.audit.log({ action: 'user.avatar_updated', actorId: userId, meta });
    return toUserDto(user);
  }

  async removeAvatar(userId: string): Promise<UserDto> {
    const previous = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null }, include: userInclude });
    await this.removeLocalAvatar(previous?.avatarUrl ?? null);
    return toUserDto(user);
  }

  /**
   * Account deletion = anonymisation. Personal data is erased and the user can never sign in
   * again, but financial records (ledger, KYC) and contest results stay for legal retention
   * and so other players' leaderboards remain correct.
   */
  async deleteAccount(userId: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, email: true, avatarUrl: true, status: true } });
    if (!user || user.status === 'DELETED') throw new NotFoundException('Account not found');

    const [inr, pending] = await Promise.all([
      this.wallet.balance(userId, 'INR'),
      this.prisma.walletTransaction.count({ where: { userId, status: 'PENDING', type: { in: ['DEPOSIT', 'WITHDRAWAL'] } } }),
    ]);
    if (pending > 0) throw new ConflictException('You have a payment or withdrawal in progress. Try again once it completes.');
    if (inr.total > 0) throw new ConflictException(`Withdraw your balance (₹${inr.total}) before deleting your account, or contact support.`);

    const targets = [user.phone, user.email].filter((t): t is string => !!t);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          name: 'Deleted user',
          phone: null,
          email: null,
          passwordHash: null,
          avatarUrl: null,
          favouriteTeam: null,
          city: null,
          dob: new Date('1900-01-01'),
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
          status: 'DELETED',
          deletedAt: new Date(),
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.pushToken.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.userSettings.deleteMany({ where: { userId } }),
      this.prisma.otpCode.deleteMany({ where: { target: { in: targets } } }),
    ]);
    forgetUserStatus(userId);
    await this.removeLocalAvatar(user.avatarUrl);
    await this.audit.log({ action: 'user.deleted', actorId: userId, entityType: 'User', entityId: userId, meta });
  }

  private async removeLocalAvatar(url: string | null): Promise<void> {
    if (!url?.startsWith(AVATAR_PUBLIC_PREFIX)) return;
    const name = url.slice(AVATAR_PUBLIC_PREFIX.length);
    if (!/^[\w-]+\.(jpg|png|webp)$/.test(name)) return;
    await unlink(join(this.avatarDir, name)).catch(() => undefined);
  }
}
