import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import type { Env } from '../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends transactional email. Implementations: console (demo), SMTP. */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`[demo] To ${message.to} — ${message.subject}\n${message.text}`);
  }
}

export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: Transporter;

  constructor(
    env: Env,
    private readonly from: string = env.MAIL_FROM,
  ) {
    this.transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.from, ...message });
    } catch {
      throw new ServiceUnavailableException('Could not send email right now. Please try again.');
    }
  }
}

export function createEmailProvider(env: Env): EmailProvider {
  return env.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider(env) : new ConsoleEmailProvider();
}

export function passwordResetEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your Dream New 11 password reset code`,
    text: `Use ${code} to reset your Dream New 11 password. The code expires in 5 minutes. If you did not request this, ignore this email.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;background:#0A1128;color:#fff;padding:32px;border-radius:16px">
<h2 style="margin:0 0 8px">Reset your password</h2>
<p style="color:#8A94B8">Use this code in the Dream New 11 app. It expires in 5 minutes.</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#22E06B">${code}</p>
<p style="color:#8A94B8;font-size:12px">If you did not request this, you can ignore this email.</p></div>`,
  };
}
