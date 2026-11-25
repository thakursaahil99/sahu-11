import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_MODE: z.enum(['demo', 'production']).default('demo'),
    ENABLE_PAID_CONTESTS: bool,
    DATABASE_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    SIGNUP_TOKEN_SECRET: z.string().min(32, 'SIGNUP_TOKEN_SECRET must be at least 32 characters'),
    OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    CORS_ORIGINS: csv,
    TRUST_PROXY: bool,
    UPLOAD_DIR: z.string().default('uploads'),

    SMS_PROVIDER: z.enum(['console', 'twilio', 'msg91']).default('console'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM: z.string().optional(),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_TEMPLATE_ID: z.string().optional(),

    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('Dream New 11 <no-reply@dreamnew11.app>'),

    SPORTS_PROVIDER: z.enum(['mock', 'cricketdata']).default('mock'),
    CRICKETDATA_API_KEY: z.string().optional(),
    SPORTS_SYNC_ENABLED: z
      .enum(['true', 'false', '1', '0'])
      .default('true')
      .transform((v) => v === 'true' || v === '1'),
    SPORTS_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(60),

    /**
     * Set only after legal review for the target region: age/KYC, TDS, geo-blocking and
     * responsible-play tools are in place. Paid play stays off without it.
     */
    REAL_MONEY_COMPLIANCE_ACK: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    /** State codes where real-money play is blocked (comma-separated). Empty = DEFAULT_RESTRICTED_STATES. */
    RESTRICTED_STATES: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))),
    /** Header set by your CDN/proxy with the visitor's country (e.g. cf-ipcountry). Real money is refused outside India. */
    GEO_COUNTRY_HEADER: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    /** TDS on net winnings at withdrawal (India s.194BA). */
    TDS_RATE_PERCENT: z.coerce.number().min(0).max(100).default(30),
    /** Demo credits granted once to each new demo wallet. */
    DEMO_WELCOME_BONUS: z.coerce.number().int().min(0).default(1000),

    LIVE_SCORING_ENABLED: z
      .enum(['true', 'false', '1', '0'])
      .default('true')
      .transform((v) => v === 'true' || v === '1'),
    /** How often live matches are polled and leaderboards recomputed. */
    LIVE_POLL_SECONDS: z.coerce.number().int().min(5).default(10),

    /** Auto-create the default contest set for upcoming matches. Unset = on in demo, off in production. */
    /** Staff must use TOTP 2FA in the admin panel. Unset = on in production, off in demo. */
    ADMIN_MFA_REQUIRED: z
      .preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false', '1', '0']).optional())
      .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),

    CONTEST_TEMPLATES_ENABLED: z
      .preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false', '1', '0']).optional())
      .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),

    /** Where the Download button points (e.g. an EAS build APK link or Play Store URL). Empty = "coming soon". */
    APP_DOWNLOAD_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
    /** Public base URL of this API, used for shareable links like /download. */
    PUBLIC_API_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),

    /** Push delivery: log (prints, for dev/demo), expo (Expo push service → FCM/APNs) or fcm (FCM HTTP v1). */
    PUSH_PROVIDER: z.enum(['log', 'expo', 'fcm']).default('log'),
    /** Optional: enables Expo's enhanced push security. */
    EXPO_ACCESS_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    /** Firebase service-account JSON (raw or base64) for PUSH_PROVIDER=fcm. */
    FCM_SERVICE_ACCOUNT_JSON: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    /** Minutes before the deadline to remind users who have a team for the match. */
    MATCH_REMINDER_MINUTES: z.coerce.number().int().min(5).max(240).default(30),

    SUPPORT_EMAIL: z.string().email().default('support@dreamnew11.app'),
    TERMS_URL: z.string().url().default('https://dreamnew11.app/terms'),
    PRIVACY_URL: z.string().url().default('https://dreamnew11.app/privacy'),
  })
  .superRefine((env, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (env.APP_MODE === 'production') {
      // Secrets must be real, and each used for one purpose only.
      const secrets = { JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET, SIGNUP_TOKEN_SECRET: env.SIGNUP_TOKEN_SECRET, OTP_SECRET: env.OTP_SECRET };
      for (const [name, value] of Object.entries(secrets)) {
        if (/change-me|example|secret-at-least/i.test(value)) fail(`${name} still has the example value — generate one with: openssl rand -base64 48`);
      }
      if (new Set(Object.values(secrets)).size < 3) fail('JWT_ACCESS_SECRET, SIGNUP_TOKEN_SECRET and OTP_SECRET must all be different');
      if (env.NODE_ENV !== 'production') fail('APP_MODE=production requires NODE_ENV=production');
      if (env.SMS_PROVIDER === 'console') fail('APP_MODE=production requires a real SMS_PROVIDER (twilio | msg91)');
      if (env.EMAIL_PROVIDER === 'console') fail('APP_MODE=production requires EMAIL_PROVIDER=smtp');
      if (env.CORS_ORIGINS.length === 0) fail('APP_MODE=production requires CORS_ORIGINS');
      // Never show generated fixtures as if they were real matches.
      if (env.ENABLE_PAID_CONTESTS && !(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET)) {
        fail('ENABLE_PAID_CONTESTS requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET');
      }
      if (env.SPORTS_PROVIDER === 'mock') fail('APP_MODE=production requires a real SPORTS_PROVIDER (cricketdata)');
    }
    if (env.SPORTS_PROVIDER === 'cricketdata' && !env.CRICKETDATA_API_KEY) {
      fail('SPORTS_PROVIDER=cricketdata requires CRICKETDATA_API_KEY');
    }
    if (env.PUSH_PROVIDER === 'fcm' && !env.FCM_SERVICE_ACCOUNT_JSON) fail('PUSH_PROVIDER=fcm requires FCM_SERVICE_ACCOUNT_JSON');
    if (env.SMS_PROVIDER === 'twilio' && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM)) {
      fail('SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM');
    }
    if (env.SMS_PROVIDER === 'msg91' && !(env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID)) {
      fail('SMS_PROVIDER=msg91 requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
    }
    if (env.EMAIL_PROVIDER === 'smtp' && !(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)) {
      fail('EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER and SMTP_PASS');
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Paid play needs production mode AND the explicit flag (and, before launch, the compliance work). */
export const paidContestsEnabled = (env: Env) => env.APP_MODE === 'production' && env.ENABLE_PAID_CONTESTS && env.REAL_MONEY_COMPLIANCE_ACK;

export const adminMfaRequired = (env: Env) => env.ADMIN_MFA_REQUIRED ?? env.APP_MODE === 'production';
export const contestTemplatesEnabled = (env: Env) => env.CONTEST_TEMPLATES_ENABLED ?? env.APP_MODE === 'demo';

/** Loads apps/api/.env, then the monorepo root .env (first definition wins), and validates. */
export function loadEnv(): Env {
  for (const file of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../../.env')]) {
    if (existsSync(file)) loadDotenv({ path: file, quiet: true });
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
