# Deployment

Three deployables, one database:

| Piece | What it is | Good homes |
| --- | --- | --- |
| **API** (`apps/api`) | NestJS + Socket.IO, long-running Node process | Railway, Render, AWS (ECS Fargate / App Runner / EC2), any Docker host |
| **Database** | PostgreSQL 16+ | Railway / Render Postgres, AWS RDS, Neon, Supabase |
| **Admin panel** (`apps/admin`) | Static React build | Vercel, Netlify, S3 + CloudFront, or the nginx image |
| **Mobile app** (`apps/mobile`) | Expo app | EAS Build → Play Store / App Store (or a direct APK) |

Read [ENV.md](ENV.md) first — the API validates its environment at boot and refuses to start with unsafe production settings.

## Before you go live

- [ ] `APP_MODE=production`, `NODE_ENV=production`, real `SMS_PROVIDER`, `EMAIL_PROVIDER=smtp`, `SPORTS_PROVIDER=cricketdata`.
- [ ] Fresh secrets: `openssl rand -base64 48` for each of `JWT_ACCESS_SECRET`, `SIGNUP_TOKEN_SECRET`, `OTP_SECRET` (all different). Store them in the platform's secret manager, never in git.
- [ ] `CORS_ORIGINS` = your admin panel URL(s). `TRUST_PROXY=true` behind a load balancer/CDN. `PUBLIC_API_URL` = the public HTTPS URL.
- [ ] Database backups on (point-in-time recovery if available). The ledger is the financial record.
- [ ] Persistent storage for `UPLOAD_DIR` (a volume), or move avatars to object storage.
- [ ] Create staff accounts, sign in to the admin panel and enrol 2FA (enforced in production). Don't run the demo seed in production — it refuses to anyway.
- [ ] **Real money stays off** unless the compliance work below is done and signed off.

## Option A — Docker (any host)

```bash
cp .env.example .env               # fill in production values (see checklist)
docker compose up -d --build       # db + migrate (one-off) + api :4000 + admin :8080
docker compose logs -f api
```

- `apps/api/Dockerfile` is multi-stage: `migrate` target (Prisma CLI, runs `prisma migrate deploy`) and a slim `runtime` target (production dependencies only, non-root user, `tini`, healthcheck on `/health`).
- `apps/admin/Dockerfile` bakes `VITE_API_URL` at build time and serves the bundle from nginx on port 8080 with SPA routing and security headers.
- Compose runs migrations before the API starts (`service_completed_successfully`) and keeps data in the `pgdata` and `uploads` volumes. For a managed database, drop the `db` service and set `DATABASE_URL`.
- Put TLS in front (Caddy, nginx, Traefik or the platform's load balancer). WebSockets must be allowed through (`Upgrade` headers).

Build images individually (from the repo root):

```bash
docker build -f apps/api/Dockerfile --target runtime -t dream11-api .
docker build -f apps/api/Dockerfile --target migrate -t dream11-migrate .
docker build -f apps/admin/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t dream11-admin .
```

## Option B — Railway

1. New project → **Add PostgreSQL**.
2. **New service → GitHub repo**. Settings → Build: *Dockerfile*, path `apps/api/Dockerfile`, target `runtime` (set `RAILWAY_DOCKERFILE_TARGET=runtime` if the UI has no target field). Root directory: repo root.
3. Variables: everything from ENV.md; `DATABASE_URL=${{Postgres.DATABASE_URL}}`. Add a volume mounted at `/data/uploads`.
4. Pre-deploy command: `npx prisma migrate deploy` needs the CLI, so either add a second service from the same Dockerfile with target `migrate` and run it on each deploy, or run it from your machine against the production `DATABASE_URL` before deploying (`npm run prisma:deploy -w @dream11/api`).
5. Health check path `/health`. Generate a domain; set `PUBLIC_API_URL` to it.

## Option C — Render

- **PostgreSQL**: create a Render Postgres; copy the *Internal* connection string.
- **Web Service** (Docker): Dockerfile path `apps/api/Dockerfile`, Docker build context `.`, target `runtime`. Health check path `/health`. Add a **Disk** at `/data/uploads`.
- **Pre-deploy command**: Render runs it in the built image, which (runtime target) has no Prisma CLI — use a **Background/Cron Job** from the `migrate` target, or deploy migrations from CI as in Railway step 4.
- Free instances sleep, which breaks live scoring and WebSockets — use a paid instance for production.

## Option D — AWS

- **Database**: RDS PostgreSQL 16 (Multi-AZ for production), private subnets, automated backups.
- **API**: push `dream11-api` to ECR → ECS Fargate service behind an Application Load Balancer (target group health check `/health`; enable stickiness or Redis adapter, see *Scaling*). Secrets from Secrets Manager / SSM. Uploads → EFS volume at `/data/uploads` (or S3).
- **Migrations**: an ECS one-off task from the `dream11-migrate` image (`prisma migrate deploy`) in the deploy pipeline before updating the service.
- **Admin**: `npm run build:admin` → S3 bucket + CloudFront (SPA fallback: 403/404 → `/index.html`), or the nginx image on ECS.
- Set `TRUST_PROXY=true` (ALB) and, if you use CloudFront for the API, `GEO_COUNTRY_HEADER=cloudfront-viewer-country`.

## Admin panel on Vercel

1. Import the repo. **Root directory** `apps/admin` (Vercel installs the workspace from the repo root).
2. Framework: Vite. Build command `npm run build`, output `dist`. `apps/admin/vercel.json` adds SPA rewrites and security headers (no indexing, no framing).
3. Environment variable `VITE_API_URL=https://<your-api>` (build time).
4. Add the Vercel URL to the API's `CORS_ORIGINS`.

## Mobile app — EAS Build

```bash
npm i -g eas-cli
cd apps/mobile
eas login
eas init                      # links the project and writes the EAS project id (needed for push)
eas build -p android --profile preview      # installable APK (internal testing / APP_DOWNLOAD_URL)
eas build -p android --profile production   # AAB for the Play Store
eas build -p ios --profile production       # needs an Apple Developer account
eas submit -p android | ios
```

- Set `EXPO_PUBLIC_API_URL` for each profile (EAS → Environment variables, or `env` in `eas.json`). Store builds can't auto-detect a dev machine.
- Push: with `PUSH_PROVIDER=expo` nothing else is needed beyond the EAS project id; Android delivery uses FCM — upload the FCM credentials in EAS (`eas credentials`). For `PUSH_PROVIDER=fcm`, also add `google-services.json` and set `FCM_SERVICE_ACCOUNT_JSON` on the API.
- Point `APP_DOWNLOAD_URL` at the APK/store link so the `/download` page and the in-app share row work.

## Scaling and operations

- **Background jobs run in every API process** (sports sync, live scoring, contest deadlines, reminders, risk scan). They're idempotent (row locks, unique keys, conditional updates), so two instances are *safe*, just wasteful. For more than one instance, set `LIVE_SCORING_ENABLED=false` and `SPORTS_SYNC_ENABLED=false` on all but one.
- **WebSockets across instances**: add the Socket.IO Redis adapter (`@socket.io/redis-adapter`) or use sticky sessions, so a broadcast reaches clients on every instance.
- **Rate limits** are in memory per instance; with several instances use a shared store (`@nestjs/throttler` Redis storage).
- **Logs**: the API logs to stdout (Nest logger). Ship them to your platform's log store; the audit trail is in the `AuditLog` table.
- **Health**: `GET /health` checks the database. Alert on 5xx rate, `/health` failures and the risk-flag queue.
- **Backups and restore drills**: test restoring the database; the ledger must reconcile (every transaction's lines sum to zero — see SCHEMA.md).

## Real money: compliance gate

Paid play needs **all** of `APP_MODE=production`, `ENABLE_PAID_CONTESTS=true`, `REAL_MONEY_COMPLIANCE_ACK=true` and Razorpay keys. Before setting the last one:

- **Law.** Real-money online gaming is restricted or banned in several Indian states, and central legislation (the 2025 online gaming act) may prohibit it outright. Get written legal advice for every region you serve. The safe default is free/practice play only — which is how this app ships.
- **Built-in controls** (verify they match your advice):
  - 18+ age gate at sign-up (client and server).
  - KYC (PAN, masked and hashed; one PAN per account) before withdrawals, reviewed in the admin panel.
  - Geo-blocking: declared state of residence required for deposits and paid entries; `RESTRICTED_STATES` blocked; optional CDN country header (`GEO_COUNTRY_HEADER`) blocks non-India traffic.
  - TDS on net winnings at withdrawal (`TDS_RATE_PERCENT`, s.194BA formula per financial year), held in a separate ledger account for remittance. Have a chartered accountant confirm the computation and set up filing (Form 26Q, certificates to users).
  - Responsible play: deposit limits with cooling-off, take-a-break/self-exclusion, admin restrictions, deletion.
  - Terms of Use and Privacy Policy (`TERMS_URL`, `PRIVACY_URL`) — have them drafted for your entity and region.
- **Payments.** Razorpay account approved for your business category; webhook configured with `RAZORPAY_WEBHOOK_SECRET`.
