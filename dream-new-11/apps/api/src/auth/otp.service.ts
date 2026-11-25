import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { DEMO_OTP, OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_RESEND_SECONDS, OTP_TTL_SECONDS } from '@dream11/shared';
import { Env, InjectEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

const MAX_CODES_PER_HOUR = 6;

export interface IssuedOtp {
  code: string;
  resendIn: number;
  expiresIn: number;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectEnv() private readonly env: Env,
  ) {}

  /** Creates a new code for target+purpose, enforcing resend cooldown and an hourly cap. */
  async issue(target: string, purpose: OtpPurpose, channel: OtpChannel, ip: string | null): Promise<IssuedOtp> {
    const now = Date.now();
    const recent = await this.prisma.otpCode.findMany({
      where: { target, purpose, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const latest = recent[0];
    if (latest) {
      const wait = OTP_RESEND_SECONDS - Math.floor((now - latest.createdAt.getTime()) / 1000);
      if (wait > 0) {
        throw new HttpException(`Please wait ${wait}s before requesting a new code`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    if (recent.length >= MAX_CODES_PER_HOUR) {
      throw new HttpException('Too many codes requested. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = this.env.APP_MODE === 'demo' ? DEMO_OTP : this.generate();
    await this.prisma.$transaction([
      // Only the newest code for a target+purpose is ever valid.
      this.prisma.otpCode.updateMany({
        where: { target, purpose, consumedAt: null },
        data: { consumedAt: new Date(now) },
      }),
      this.prisma.otpCode.create({
        data: {
          target,
          purpose,
          channel,
          codeHash: this.hash(target, purpose, code),
          expiresAt: new Date(now + OTP_TTL_SECONDS * 1000),
          ip,
        },
      }),
    ]);
    return { code, resendIn: OTP_RESEND_SECONDS, expiresIn: OTP_TTL_SECONDS };
  }

  /** Verifies and consumes the active code. Throws a user-facing error on any failure. */
  async consume(target: string, purpose: OtpPurpose, code: string): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { target, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException({ message: 'Code expired. Please request a new one.', fields: { code: 'Code expired' } });
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpException('Too many wrong attempts. Please request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hash(target, purpose, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const updated = await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const left = OTP_MAX_ATTEMPTS - updated.attempts;
      const message = left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Please request a new code.';
      throw new BadRequestException({ message, fields: { code: message } });
    }

    // Conditional update makes consumption single-use even under concurrent requests.
    const { count } = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException({ message: 'Code already used. Please request a new one.', fields: { code: 'Code already used' } });
  }

  private generate(): string {
    return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
  }

  private hash(target: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.env.OTP_SECRET).update(`${purpose}:${target}:${code}`).digest('hex');
  }
}
