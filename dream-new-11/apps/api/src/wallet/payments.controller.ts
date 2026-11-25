import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/jwt-auth.guard';
import { zodBody } from '../common/zod-validation.pipe';
import { WalletService } from './wallet.service';

const completeSchema = z.object({
  t: z.string().min(10),
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/),
});

/** JSON safe to embed in an inline <script> (a value can never close the tag). */
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * Helmet's default CSP blocks third-party and inline scripts, so the checkout page sends its
 * own: only our nonce'd inline script and Razorpay's origins may run, frame or be called.
 */
const checkoutCsp = (nonce: string) =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://checkout.razorpay.com`,
    "style-src 'unsafe-inline'",
    'img-src data: https://*.razorpay.com',
    "connect-src 'self' https://*.razorpay.com",
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

/**
 * Public payment endpoints. The app opens /pay/:id in an in-app browser; Razorpay Checkout runs
 * there and its result is verified server-side. The webhook is the source of truth either way,
 * and crediting is idempotent so both paths can arrive in any order.
 */
@Public()
@Controller()
export class PaymentsController {
  constructor(private readonly wallet: WalletService) {}

  @Get('pay/:id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async checkout(@Param('id') id: string, @Query('t') token: string, @Res({ passthrough: true }) res: Response): Promise<string> {
    const txId = await this.wallet.verifyCheckoutToken(token ?? '');
    if (txId !== id) throw new UnauthorizedException('Invalid payment link');
    const { t, keyId } = await this.wallet.checkoutDetails(id);
    const amountPaise = (t.metadata as { requestedX100?: number } | null)?.requestedX100 ?? 0;
    const prefill = { name: t.user.name, email: t.user.email ?? '', contact: t.user.phone ?? '' };
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Security-Policy', checkoutCsp(nonce));
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add cash · Dream New 11</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A1128;color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center;padding:24px}
.btn{display:inline-block;margin-top:16px;padding:14px 28px;border-radius:14px;background:#22E06B;color:#0A1128;font-weight:800;border:0;font-size:16px}p{color:#8A94B8}</style>
<script nonce="${nonce}" src="https://checkout.razorpay.com/v1/checkout.js"></script></head><body><main>
<h2>Add ₹${(amountPaise / 100).toLocaleString('en-IN')}</h2><p id="msg">Opening secure checkout…</p><button class="btn" id="pay">Pay now</button>
<script nonce="${nonce}">
const done = (s) => { location.href = 'dreamnew11://wallet?deposit=' + s; };
const rz = new Razorpay({
  key: ${json(keyId)}, amount: ${amountPaise}, currency: 'INR', order_id: ${json(t.reference)},
  name: 'Dream New 11', description: 'Add cash', prefill: ${json(prefill)}, theme: { color: '#22E06B' },
  handler: async (r) => {
    document.getElementById('msg').textContent = 'Confirming payment…';
    const res = await fetch('/payments/razorpay/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: ${json(token)}, ...r }) });
    done(res.ok ? 'success' : 'failed');
  },
  modal: { ondismiss: () => done('cancelled') },
});
rz.on('payment.failed', () => done('failed'));
document.getElementById('pay').onclick = () => rz.open();
rz.open();
</script></main></body></html>`;
  }

  @Post('payments/razorpay/complete')
  @HttpCode(200)
  async complete(@Body(zodBody(completeSchema)) body: z.output<typeof completeSchema>) {
    const txId = await this.wallet.verifyCheckoutToken(body.t);
    const status = await this.wallet.confirmFromCheckout(txId, body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature);
    return { status };
  }

  /** Razorpay webhook. Signature is checked against the raw body; invalid ones get 401 so they can be spotted. */
  @Post('webhooks/razorpay')
  @SkipThrottle()
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature: string | undefined) {
    const ok = req.rawBody && signature ? await this.wallet.handleWebhook(req.rawBody, signature) : false;
    if (!ok) throw new UnauthorizedException('Invalid webhook signature');
    return { received: true };
  }
}
