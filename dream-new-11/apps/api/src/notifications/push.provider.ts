import { Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import type { PushTokenKind } from '@prisma/client';
import type { Env } from '../config/env';

export interface PushMessage {
  title: string;
  body: string;
  /** Delivered as string key/values; the app opens `url` on tap. */
  data: Record<string, string>;
}

export interface PushTarget {
  token: string;
  kind: PushTokenKind;
}

export interface PushProvider {
  readonly name: string;
  /** Sends to every target it supports; returns tokens the service reported as dead. */
  send(targets: PushTarget[], message: PushMessage): Promise<{ invalid: string[] }>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

const chunk = <T>(arr: T[], size: number): T[][] => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

/** Development/demo: prints instead of sending. */
export class LogPushProvider implements PushProvider {
  readonly name = 'log';
  private readonly logger = new Logger('Push');

  async send(targets: PushTarget[], m: PushMessage): Promise<{ invalid: string[] }> {
    if (targets.length) this.logger.log(`→ ${targets.length} device(s): ${m.title} — ${m.body}`);
    return { invalid: [] };
  }
}

/** Expo push service (routes to FCM on Android and APNs on iOS). Handles EXPO tokens. */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  private readonly logger = new Logger('ExpoPush');

  constructor(private readonly accessToken?: string) {}

  async send(targets: PushTarget[], m: PushMessage): Promise<{ invalid: string[] }> {
    const invalid: string[] = [];
    const tokens = targets.filter((t) => t.kind === 'EXPO').map((t) => t.token);
    for (const batch of chunk(tokens, 100)) {
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(batch.map((to) => ({ to, title: m.title, body: m.body, data: m.data, sound: 'default', channelId: 'default', priority: 'high' }))),
        });
        if (!res.ok) {
          this.logger.warn(`Expo push failed: HTTP ${res.status}`);
          continue;
        }
        const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        json.data?.forEach((ticket, i) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') invalid.push(batch[i]!);
        });
      } catch (err) {
        this.logger.warn(`Expo push error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { invalid };
  }
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Firebase Cloud Messaging HTTP v1 with a service account. Handles FCM tokens. */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  private readonly logger = new Logger('FcmPush');
  private readonly sa: ServiceAccount;
  private access: { token: string; expiresAt: number } | null = null;

  constructor(serviceAccountJson: string) {
    const raw = serviceAccountJson.trim().startsWith('{') ? serviceAccountJson : Buffer.from(serviceAccountJson, 'base64').toString('utf8');
    this.sa = JSON.parse(raw) as ServiceAccount;
    if (!this.sa.project_id || !this.sa.client_email || !this.sa.private_key) throw new Error('FCM_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key');
  }

  async send(targets: PushTarget[], m: PushMessage): Promise<{ invalid: string[] }> {
    const tokens = targets.filter((t) => t.kind === 'FCM').map((t) => t.token);
    if (!tokens.length) return { invalid: [] };
    const invalid: string[] = [];
    let bearer: string;
    try {
      bearer = await this.accessToken();
    } catch (err) {
      this.logger.error(`FCM auth failed: ${err instanceof Error ? err.message : String(err)}`);
      return { invalid };
    }
    const url = `https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`;
    for (const batch of chunk(tokens, 20)) {
      await Promise.all(
        batch.map(async (token) => {
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
              body: JSON.stringify({
                message: {
                  token,
                  notification: { title: m.title, body: m.body },
                  data: m.data,
                  android: { priority: 'high', notification: { channel_id: 'default' } },
                  apns: { payload: { aps: { sound: 'default' } } },
                },
              }),
            });
            if (res.ok) return;
            const text = await res.text();
            if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) invalid.push(token);
            else this.logger.warn(`FCM send failed: HTTP ${res.status} ${text.slice(0, 200)}`);
          } catch (err) {
            this.logger.warn(`FCM send error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );
    }
    return { invalid };
  }

  /** OAuth2 service-account flow (JWT bearer), cached until shortly before expiry. */
  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: this.sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.sa.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    if (!res.ok) throw new Error(`token endpoint HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.access = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}

export function createPushProvider(env: Env): PushProvider {
  if (env.PUSH_PROVIDER === 'expo') return new ExpoPushProvider(env.EXPO_ACCESS_TOKEN);
  if (env.PUSH_PROVIDER === 'fcm') return new FcmPushProvider(env.FCM_SERVICE_ACCOUNT_JSON!);
  return new LogPushProvider();
}
