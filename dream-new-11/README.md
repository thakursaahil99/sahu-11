# Dream New 11

**Create Your Team. Play Your Game.** — an original fantasy cricket app (Android + iOS) with a NestJS API and a React admin panel.

> Ships **practice/free-only by default** (`APP_MODE=demo`). Real-money play stays disabled until `APP_MODE=production`, `ENABLE_PAID_CONTESTS=true` and `REAL_MONEY_COMPLIANCE_ACK=true` — see the compliance gate in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#real-money-compliance-gate). Real-money fantasy gaming is restricted or banned in several regions (including recent Indian law) — get legal advice first.

**Docs:** [API reference](docs/API.md) · [Database schema](docs/SCHEMA.md) · [Environment variables](docs/ENV.md) · [Deployment](docs/DEPLOYMENT.md)

## Monorepo

```
apps/mobile       Expo SDK 58 + Expo Router (TypeScript)
apps/api          NestJS 11 + Prisma 6 + PostgreSQL
apps/admin        Admin panel: React 19 + Vite + Tailwind CSS 4
packages/shared   Types, zod validation, scoring/team/prize rules, compliance helpers (shared by API, app and admin)
scripts/          Local Postgres (no Docker), icon generator, API/schema doc generators
docs/             API, schema, environment and deployment guides
```

## 5-minute local start

Requires Node 20.19+.

```bash
npm install
cp .env.example .env        # demo mode works as-is; change the secrets for anything shared

npm run db:start            # terminal 1 — real Postgres on :5433, data in ./.pgdata (no Docker)
npm run db:migrate          # terminal 2 — create tables
npm run db:seed             #            — demo accounts
npm run dev:api             #            — API on http://localhost:4000

npm run dev:mobile          # terminal 3 — scan the QR code with Expo Go (SDK 58)
npm run dev:admin           # terminal 4 — admin panel on http://localhost:5174
```

**Prefer Docker?** `cp .env.example .env && docker compose up -d --build` runs PostgreSQL, migrations, the API (:4000) and the admin panel (:8080); add demo accounts with `docker compose --profile seed run --rm seed`. See [DEPLOYMENT.md](docs/DEPLOYMENT.md).

The local database is always created as UTF-8 (needed for ₹ and names in Indian scripts). If you have a `.pgdata` from before this was added, `db:start` warns you; delete `.pgdata` and re-run `db:start`, `db:migrate`, `db:seed`.

After changing `packages/shared`, rebuild it (`npm run build:shared`) and restart `dev:api` — the API's watcher only reloads on changes in `apps/api/src`.

The app finds the API automatically on your dev machine's LAN IP. If your phone can't reach it, set `EXPO_PUBLIC_API_URL=http://<your-pc-ip>:4000` in `apps/mobile/.env` and allow port 4000 through the firewall.

### Demo logins

| Method | Credentials |
| --- | --- |
| Mobile + OTP | `9999999999`, code `123456` (any new number signs you up) |
| Email | `demo@dreamnew11.app` / `Demo@1234` |
| Admin panel — super admin | `admin@dreamnew11.app` / `Admin@1234` |
| Admin panel — content / support / finance | `content@`, `support@`, `finance@dreamnew11.app` / `Admin@1234` |

In demo mode every OTP is `123456` and SMS/email are printed to the API console.

## Tests

```bash
npm test                              # unit: scoring engine, team rules, prizes, age/phone/password, TDS, TOTP (RFC 6238), fixtures
npm run test:int -w @dream11/api      # integration (real database): live pipeline on a simulated clock; wallet ledger,
                                      # payment webhooks + signatures, concurrency, limits, geo-blocking, TDS
npm run test:e2e -w @dream11/api      # e2e against the running API: auth, teams, contests (join concurrency), sockets,
                                      # wallet, account, admin (RBAC, 2FA, step-up), security (headers, CORS, limits,
                                      # injection, forged tokens). ~9 min: suites are spaced a minute apart (rate limits)
npm run typecheck                     # all workspaces
npm run docs:api && npm run docs:schema   # regenerate docs/API.md and docs/SCHEMA.md from the code
```

## Sports data

Fixtures and squads come from a `SportsProvider`, chosen with `SPORTS_PROVIDER`:

- `mock` (demo only) — eight fictional franchises, three T20s a day from 3 days ago to 7 days ahead. Deterministic, and matches move Upcoming → Live → Completed with the real clock (slots at 10:00, 15:30 and 19:30 IST, 3.5 h each). Lineups appear 45 min before start.
- `cricketdata` — [CricketData.org](https://cricketdata.org) v1 API; needs `CRICKETDATA_API_KEY`. It has no fantasy prices, so players start at 8.0 credits (adjust in the admin panel). On the free plan set `SPORTS_SYNC_INTERVAL_SECONDS=1800` or higher.

The sync runs on boot and every `SPORTS_SYNC_INTERVAL_SECONDS`. `APP_MODE=production` refuses to start with the mock provider.

Endpoints: `GET /sports`, `GET /matches/feed?sport=cricket`, `GET /matches?sport=&status=&limit=&cursor=`, `GET /matches/:id`.

## Teams

Rules live in the `FantasyConfig` table (one row per sport, created with defaults on first use): 11 players, 100 credits, max 7 from one side, WK 1–4, BAT 3–6, AR 1–4, BOWL 3–6, up to 6 teams per match, captain 2x, vice-captain 1.5x.

The same rule code (`packages/shared/src/fantasy/team-rules.ts`) drives the app's live checks and the server's validation. The server re-checks everything on save: squad membership, composition, credits, leaders, the deadline (teams lock at the scheduled start), the per-match team limit (serialised with a Postgres advisory lock), and identical-team duplicates. Player prices are locked when a team is saved.

Endpoints: `GET /fantasy/rules?sport=`, `GET /matches/:id/builder`, `GET /teams?matchId=`, `GET /teams/:id`, `POST /teams`, `PUT /teams/:id`.

## Contests

Types: `PRACTICE` (no prizes), `FREE` (demo-credit prizes in demo mode), `PRIVATE` (invite code, bragging rights) and `PUBLIC` (paid). **Paid contests are hidden and refused** unless `APP_MODE=production`, `ENABLE_PAID_CONTESTS=true` and `REAL_MONEY_COMPLIANCE_ACK=true` (see Wallet).

- In demo mode every upcoming match gets a default set automatically (Free Mega 10,000 DC, Winner Takes All, Top 3 Showdown, Practice Arena, Head-to-Head Practice). Toggle with `CONTEST_TEMPLATES_ENABLED`.
- Joins lock the contest row (`SELECT … FOR UPDATE`) so spots never overfill and per-user entry limits hold under concurrency; a Postgres `CHECK` constraint backs this up.
- At the deadline, contests lock; non-guaranteed contests that didn't fill (and private contests with fewer than 2 teams) are cancelled.
- Teams can be switched inside a contest until the deadline. Tied teams share the prizes of the ranks they cover.

Endpoints: `GET /matches/:id/contests`, `GET /contests/:id`, `POST /contests/:id/join`, `PUT /contests/:id/entries/:entryId`, `POST /contests/private`, `GET /contests/invite/:code`, `GET /me/matches?status=`.

## Live scoring

- **Scoring engine** (`packages/shared/src/fantasy/scoring.ts`): T20 and T10 points tables — runs, boundary/six bonuses, 30/50/100 milestones, ducks, strike rate and economy slabs, wickets, bowled/LBW bonus, hauls, maidens, catches (3-catch bonus), stumpings and run-outs. Tables live in `ScoringConfig` per sport + format and are editable by admins.
- **Demo simulation**: the mock provider plays every match ball by ball from a seed. T20s release a delivery every 45 s; an hourly **Blitz T10** (on the hour, ~20 minutes) releases one every 8 s so you can watch a whole match.
- **Pipeline** (every `LIVE_POLL_SECONDS`): provider scorecard → player points → team points (captain 2x, VC 1.5x) → contest ranks (`RANK()`, ties share a rank) in set-based SQL; unchanged scorecards are skipped.
- **Real time**: Socket.IO namespace `/live`, rooms `match:<id>` and `contest:<id>`, authenticated with the access token. Events: `match:live` (score), `leaderboard:delta` (only changed entries), `contest:status`.
- **Settlement**: when the result is final, each running contest gets final ranks and winnings (tied ranks split the prizes for the positions they cover), exactly once, with an audit log entry. Winnings are credited to the wallet in the same step (idempotent per entry); cancelled contests are refunded.

Endpoints: `GET /matches/:id/live`, `GET /contests/:id/entries/:entryId` (other players' teams unlock at the deadline).

## Wallet

**Demo mode (default):** every user gets a one-time welcome bonus of `DEMO_WELCOME_BONUS` demo credits (DC, no cash value). DC pays free-contest entry and receives winnings. Deposits and withdrawals are switched off (the API answers 403) and the app says so.

**Real money** is off unless all three are set: `APP_MODE=production`, `ENABLE_PAID_CONTESTS=true` and `REAL_MONEY_COMPLIANCE_ACK=true`. The last one is your statement that you hold the licences and legal advice needed for paid fantasy play where you operate (several Indian states prohibit it, and central online-gaming law changes affect it — check before enabling). Razorpay keys are then required at boot.

- **Ledger:** double-entry. Every movement is a `WalletTransaction` whose `LedgerEntry` lines sum to zero; balances are always computed from entries, never stored. A database trigger rejects updates to ledger lines. Each transaction has an idempotency key (`win:<entryId>`, `entry:<contest>:<team>`, `refund:<tx>`, `dep:<order>`…), so retries and duplicate webhooks never double-post.
- **Buckets:** deposited, winnings and bonus. Entry fees use bonus (capped at 10% of each fee), then deposited, then winnings. Only winnings can be withdrawn.
- **Deposits:** `POST /wallet/deposits` creates a Razorpay order and returns a short-lived hosted checkout URL (`/pay/:id`). Money is credited only after the payment signature is verified (checkout callback) or a signed `payment.captured` webhook reaches `POST /webhooks/razorpay`, whichever comes first; the other is a no-op. The app shows success only once the server has recorded it. Limits: ₹10–₹1,00,000 per deposit.
- **KYC:** PAN + name (`POST /me/kyc`). The PAN is stored masked plus a peppered hash, so one PAN can't back two accounts. Review happens in the admin panel (Phase 8).
- **Withdrawals:** need verified KYC and at least ₹100 of winnings. The amount moves to a hold account at request time and is paid out or released when an admin approves or rejects it.
- **TDS:** withdrawals withhold `TDS_RATE_PERCENT` (30%) of *net winnings* for the financial year (withdrawals − deposits − opening balance − already taxed, per Income-tax Act s.194BA) into a separate ledger account; a rejected withdrawal returns the full amount. Confirm with a chartered accountant.
- **Geo-blocking:** deposits and paid entries need a declared state of residence (Edit profile) outside `RESTRICTED_STATES`, and — if `GEO_COUNTRY_HEADER` is set — traffic from India. Withdrawals are never blocked.

Point the Razorpay webhook at `https://<api>/webhooks/razorpay` for `payment.captured` and `payment.failed`, and set `RAZORPAY_WEBHOOK_SECRET`.

Endpoints: `GET /wallet`, `GET /wallet/transactions?cursor=`, `POST /wallet/deposits`, `POST /wallet/withdrawals`, `GET|POST /me/kyc`.

## Notifications

Every notification is stored first (the in-app notification centre is the source of truth), then delivered live over Socket.IO to open apps (each connection joins a private `user:<id>` room) and by push to devices. Each trigger has a dedupe key, so retries, repeated ticks or several API instances never notify twice.

| Trigger | When |
| --- | --- |
| Match reminder | `MATCH_REMINDER_MINUTES` before the deadline, to users with a team (nudges them if they haven’t joined a contest) |
| Contest joined | On every successful join |
| Match start | First live update of a match, to everyone with an entry |
| Results | After settlement, one per user per contest with best rank and winnings |
| Contest cancelled | With the refund note |
| Transactions | Deposit success/failure, withdrawal requested/approved/rejected |
| KYC, support replies, announcements | From the admin panel (Phase 8) |

Push is pluggable with `PUSH_PROVIDER`: `log` (prints; default), `expo` (Expo push service → FCM/APNs; needs an EAS build with a project id) or `fcm` (Firebase HTTP v1 with `FCM_SERVICE_ACCOUNT_JSON`). Dead tokens are removed automatically. Users control match reminders, contest updates and promotions in Settings; money and account messages always go out. The app asks for push permission with an in-app card first, so a "not now" doesn’t use up the one-time system prompt.

Endpoints: `GET /notifications?cursor=`, `GET /notifications/unread-count`, `POST /notifications/read` (`{ids}` or `{all:true}`), `POST|DELETE /me/push-tokens`.

## Profile, support and responsible play

- **History:** `GET /me/stats` (contests, teams, matches, wins, best rank, total won, points over the last 10 matches) and `GET /me/contests?cursor=` (every entry with points, rank and winnings).
- **Help & support:** searchable FAQs in the app; tickets with a reference (`DN-12345`) and a message thread — `GET|POST /support/tickets`, `GET /support/tickets/:id`, `POST /support/tickets/:id/messages`. Up to 5 open tickets per user; creation is rate-limited.
- **Responsible play** (`/me/responsible-play`): daily/weekly/monthly deposit limits — lowering applies now, raising or removing waits 24 hours and can be cancelled; deposits are checked against them (pending payments count). **Take a break** for 1 day to 1 year: no contests, teams or deposits, but the user can still log in and withdraw; a break can’t be shortened. Admin restrictions (status `RESTRICTED`, Phase 8) block play the same way.
- **Delete account** (`DELETE /me` with `{confirm:"DELETE"}`): anonymises the user — name, phone, email, photo, DOB, settings, devices and notifications are erased; sessions are revoked and existing access tokens stop working at once. Ledger and KYC records and past contest results are kept for legal retention and correct leaderboards. Refused while a payment is pending or a real-money balance remains.

## Admin panel

`apps/admin` (React + Vite + Tailwind) talks to `/admin/*` on the API. Run it with `npm run dev:admin` (port 5174; set `VITE_API_URL` for another API, and add the panel's origin to `CORS_ORIGINS`).

| Area | What staff can do |
| --- | --- |
| Dashboard | Players, live matches, running contests, 7-day money totals, sign-ups chart, queues that need attention |
| Users | Search, full profile (wallet, contests, flags, activity), restrict from play, suspend (signs out everywhere), change role, reset 2FA |
| KYC | Review PAN submissions; PANs already on another account and name mismatches are highlighted; approve/reject notifies the player |
| Withdrawals / Transactions | Approve or reject held withdrawals (staff can't approve their own); browse the ledger |
| Matches / Contests | Fixture sync, recompute points, abandon a match (cancels + refunds every contest), create free/practice contests with a validated prize breakup, cancel contests, standings |
| Players, scoring rules, team rules | Credits and roles; points tables per format; team composition rules (validated so a full team is always possible) |
| Support | Inbox (oldest waiting first), threaded replies that notify the player |
| Risk flags | Many sign-ups from one IP, rapid deposits, deposit→withdraw without playing, PAN reuse. Scanned every 30 minutes; staff dismiss or action with a note |
| Announcements | Notification-centre + push to all or recently active players; promotional ones respect opt-outs and skip players on a break |
| Audit log | Every sign-in, money movement and admin action, with before/after values |

**Security model**

- **Separate admin sessions.** Only `POST /admin/auth/login` issues admin-scope tokens; a staff member's app session can't call admin routes. Admin sessions end after 12 hours, however often they refresh.
- **RBAC.** Roles map to permissions in `packages/shared/src/admin.ts` (super admin, content admin, support, finance). The role is re-read from the database on every admin request, so demotions apply immediately (and end that person's sessions).
- **2FA (TOTP).** Google Authenticator / Authy compatible. Secrets are encrypted at rest (AES-256-GCM); codes can't be replayed. Required for staff when `ADMIN_MFA_REQUIRED=true` (default on in production): until it's set up, only the enrolment screens work. A super admin can reset a lost authenticator.
- **Step-up for sensitive actions** (suspend, role changes, withdrawals, scoring/team rules, abandoning matches, cancelling contests, announcements): the panel asks for the password or a fresh 2FA code and gets a 5-minute token bound to that person.
- Every admin action writes an audit entry; staff can't change their own role/status or review their own KYC/withdrawals.

## Auth at a glance

- Mobile OTP login/signup, email + password signup/login, forgot/reset password by emailed code.
- 15-minute JWT access tokens; opaque refresh tokens rotated on every use and stored hashed. Replaying an old refresh token revokes that whole session family.
- OTPs stored as HMACs, single-use, 5-minute expiry, 30-second resend cooldown, 5 attempts, hourly cap.
- bcrypt (bcryptjs, 12 rounds) passwords, per-route rate limits, Helmet, CORS allow-list, zod validation shared with the app.
- 18+ age gate enforced on both client and server. Every auth event is written to the audit log.
- Tokens live in the iOS Keychain / Android Keystore via `expo-secure-store`.
