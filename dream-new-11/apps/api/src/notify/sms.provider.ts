import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Env } from '../config/env';

/** Sends one-time codes by SMS. Implementations: console (demo), Twilio, MSG91. */
export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.log(`[demo] OTP for ${phone}: ${code}`);
  }
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: phone,
        From: this.from,
        Body: `${code} is your Dream New 11 verification code. It expires in 5 minutes. Do not share it.`,
      }),
    });
    if (!res.ok) throw new ServiceUnavailableException('Could not send SMS right now. Please try again.');
  }
}

export class Msg91SmsProvider implements SmsProvider {
  constructor(
    private readonly authKey: string,
    private readonly templateId: string,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const res = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: this.authKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: this.templateId,
        short_url: '0',
        recipients: [{ mobiles: phone.replace(/^\+/, ''), otp: code }],
      }),
    });
    if (!res.ok) throw new ServiceUnavailableException('Could not send SMS right now. Please try again.');
  }
}

export function createSmsProvider(env: Env): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'twilio':
      return new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, env.TWILIO_FROM!);
    case 'msg91':
      return new Msg91SmsProvider(env.MSG91_AUTH_KEY!, env.MSG91_TEMPLATE_ID!);
    case 'console':
      return new ConsoleSmsProvider();
  }
}
