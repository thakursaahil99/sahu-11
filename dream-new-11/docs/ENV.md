# Environment variables

The API reads `.env` at the repository root (or real environment variables) and **validates everything at boot** (`apps/api/src/config/env.ts`). A bad or missing value stops the server with a list of every problem, so a misconfigured deploy never half-starts.

`APP_MODE=production` turns on extra checks (marked **prod** below). Copy `.env.example` to start.

## Core

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. **prod:** must be `production`. |
| `PORT` | `4000` | HTTP port. |
| `APP_MODE` | `demo` | `demo` = practice/free play with demo credits, mock fixtures allowed, OTPs printed to the console. `production` = real providers required. |
| `DATABASE_URL` | — (required) | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/dream11?schema=public`. Use `sslmode=require` for managed databases. |
| `PUBLIC_API_URL` | `http://localhost:PORT` | Public base URL of the API (checkout links, `/download`). **Set it in production.** |
| `CORS_ORIGINS` | empty | Comma-separated browser origins allowed to call the API (the admin panel). Mobile apps send no Origin. Empty = any origin in development, none in production. **prod:** required. |
| `TRUST_PROXY` | `false` | `true` behind a load balancer/CDN so rate limits and audit logs see the real client IP. |
| `UPLOAD_DIR` | `uploads` | Where avatars are stored. Use a persistent volume (or swap for object storage) in production. |

## Secrets and sessions

Generate each with `openssl rand -base64 48`. **prod:** none may keep the example value, and all three must differ.

| Variable | Default | Description |
| --- | --- | --- |
| `JWT_ACCESS_SECRET` | — (≥32 chars) | Signs access tokens, checkout links, 2FA challenges and step-up tokens. Rotating it signs everyone out. |
| `SIGNUP_TOKEN_SECRET` | — (≥32 chars) | Signs the short-lived token between OTP verification and profile completion. |
| `OTP_SECRET` | — (≥32 chars) | HMAC key for stored OTPs; also the pepper for PAN hashes and the key for encrypting staff 2FA secrets. **Don't rotate** without re-encrypting 2FA secrets (or resetting staff 2FA). |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access-token lifetime. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | App refresh-token lifetime (rotated on every use). Admin sessions are always capped at 12 hours. |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost (10–15). |
| `ADMIN_MFA_REQUIRED` | on in production, off in demo | Staff must enrol TOTP 2FA before using the admin panel. |

## SMS and email

| Variable | Default | Description |
| --- | --- | --- |
| `SMS_PROVIDER` | `console` | `console` (prints OTPs), `twilio` or `msg91`. **prod:** not `console`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | — | Required for `twilio`. |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | — | Required for `msg91` (a DLT-registered OTP template). |
| `EMAIL_PROVIDER` | `console` | `console` or `smtp`. **prod:** `smtp`. |
| `SMTP_HOST`, `SMTP_PORT` (`587`), `SMTP_USER`, `SMTP_PASS` | — | Required for `smtp`. |
| `MAIL_FROM` | `Dream New 11 <no-reply@dreamnew11.app>` | Sender for password-reset codes. |

## Sports data and live scoring

| Variable | Default | Description |
| --- | --- | --- |
| `SPORTS_PROVIDER` | `mock` | `mock` (generated fixtures + ball-by-ball simulator; demo only) or `cricketdata`. **prod:** not `mock`. |
| `CRICKETDATA_API_KEY` | — | Required for `cricketdata`. |
| `SPORTS_SYNC_ENABLED` | `true` | Fixture/squad sync on boot and on an interval. |
| `SPORTS_SYNC_INTERVAL_SECONDS` | `60` | Sync interval (≥30). Use ≥1800 on CricketData's free plan. |
| `LIVE_SCORING_ENABLED` | `true` | Live points/leaderboard pipeline. Run it on exactly one instance if you scale out (see DEPLOYMENT.md). |
| `LIVE_POLL_SECONDS` | `10` | How often live matches are polled. |
| `CONTEST_TEMPLATES_ENABLED` | on in demo, off in production | Auto-create the default free contest set for every upcoming match. |

## Wallet and real money

Real money is enabled only when **all** of `APP_MODE=production`, `ENABLE_PAID_CONTESTS=true` and `REAL_MONEY_COMPLIANCE_ACK=true` are set.

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_PAID_CONTESTS` | `false` | Paid contests and deposits. |
| `REAL_MONEY_COMPLIANCE_ACK` | `false` | Your confirmation that legal review, licences, KYC, TDS, geo-blocking and responsible-play are in place for where you operate. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | — | **prod + paid:** all required. Webhook URL: `https://<api>/webhooks/razorpay` (`payment.captured`, `payment.failed`). |
| `RESTRICTED_STATES` | `AP,TG,AS,OR,SK,NL` | State codes where real-money play is blocked. **Set from current legal advice.** |
| `GEO_COUNTRY_HEADER` | — | Header your CDN adds with the visitor's country (e.g. `cf-ipcountry` on Cloudflare). Deposits and paid entries are refused outside India. Only set it if the header is added by your own proxy (clients could forge it otherwise). |
| `TDS_RATE_PERCENT` | `30` | TDS on net winnings at withdrawal (Income-tax Act s.194BA). `0` disables. Confirm with a chartered accountant. |
| `DEMO_WELCOME_BONUS` | `1000` | Demo credits granted once per user in demo mode. |

## Notifications

| Variable | Default | Description |
| --- | --- | --- |
| `PUSH_PROVIDER` | `log` | `log` (prints), `expo` (Expo push service → FCM/APNs) or `fcm` (Firebase HTTP v1). |
| `EXPO_ACCESS_TOKEN` | — | Optional, for Expo's enhanced push security. |
| `FCM_SERVICE_ACCOUNT_JSON` | — | Firebase service-account JSON (raw or base64). Required for `fcm`. |
| `MATCH_REMINDER_MINUTES` | `30` | Reminder lead time before the deadline (5–240). |

## Links

| Variable | Default | Description |
| --- | --- | --- |
| `SUPPORT_EMAIL` | `support@dreamnew11.app` | Shown in the app. |
| `TERMS_URL`, `PRIVACY_URL` | `https://dreamnew11.app/…` | Legal pages linked from sign-up and profile. |
| `APP_DOWNLOAD_URL` | — | Where the `/download` page's button points (EAS APK link or store URL). Empty = "coming soon". |

## Apps

| Variable | Where | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/.env` or EAS env | API base URL baked into the app build. Empty in development = auto-detect the dev machine's LAN IP. **Required for store builds.** |
| `VITE_API_URL` | `apps/admin/.env` or Vercel env | API base URL for the admin panel (build time). Add the panel's origin to `CORS_ORIGINS`. |
