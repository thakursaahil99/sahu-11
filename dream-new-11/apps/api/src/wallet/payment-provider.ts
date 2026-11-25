import { ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaymentOrder {
  orderId: string;
  /** Paise. */
  amount: number;
  currency: 'INR';
}

export interface WebhookEvent {
  type: 'captured' | 'failed' | 'other';
  orderId: string | null;
  paymentId: string | null;
}

/** Abstraction over the payment gateway. Implementation: Razorpay. */
export interface PaymentProvider {
  readonly name: string;
  /** Public key the checkout page needs. */
  readonly publicKey: string;
  createOrder(amountPaise: number, receipt: string): Promise<PaymentOrder>;
  /** Verifies the signature the checkout returns to the client after payment. */
  verifyPayment(orderId: string, paymentId: string, signature: string): boolean;
  /** Verifies and parses a webhook using the raw request body. */
  parseWebhook(rawBody: Buffer, signature: string): WebhookEvent | null;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';

  constructor(
    readonly publicKey: string,
    private readonly secret: string,
    private readonly webhookSecret: string,
  ) {}

  async createOrder(amountPaise: number, receipt: string): Promise<PaymentOrder> {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, payment_capture: 1 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ServiceUnavailableException('Payments are unavailable right now. Please try again.');
    const body = (await res.json()) as { id?: string; amount?: number };
    if (!body.id || body.amount !== amountPaise) throw new ServiceUnavailableException('Payment order could not be created.');
    return { orderId: body.id, amount: amountPaise, currency: 'INR' };
  }

  /** Razorpay: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
  verifyPayment(orderId: string, paymentId: string, signature: string): boolean {
    const expected = createHmac('sha256', this.secret).update(`${orderId}|${paymentId}`).digest('hex');
    return safeEqualHex(expected, signature);
  }

  /** Razorpay: HMAC_SHA256(raw body, webhook secret) in X-Razorpay-Signature. */
  parseWebhook(rawBody: Buffer, signature: string): WebhookEvent | null {
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    if (!safeEqualHex(expected, signature)) return null;
    const body = JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
    };
    const entity = body.payload?.payment?.entity;
    const type = body.event === 'payment.captured' ? 'captured' : body.event === 'payment.failed' ? 'failed' : 'other';
    return { type, orderId: entity?.order_id ?? null, paymentId: entity?.id ?? null };
  }
}
