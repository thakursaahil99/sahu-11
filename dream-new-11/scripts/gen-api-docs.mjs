// Generates docs/API.md from the NestJS controllers, so the route list can't drift from the code.
// Usage: npm run docs:api
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'apps/api/src');

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) files.push(p);
  }
})(SRC);

const GROUPS = [
  ['System', /app\.controller|download/],
  ['Auth', /auth\/auth/],
  ['Profile & account', /users\//],
  ['Matches', /sports\//],
  ['Teams', /teams\//],
  ['Contests', /contests\//],
  ['Live', /live\//],
  ['Wallet & payments', /wallet\//],
  ['Notifications', /notifications\//],
  ['Support', /support\//],
  ['Responsible play', /responsible-play\//],
  ['Admin', /admin\//],
];

/** Descriptions for routes without a JSDoc comment in the controller. */
const DESCRIPTIONS = {
  'GET /health': 'Liveness + database check: `{ status: "ok", mode, time }`.',
  'GET /download': 'HTML page with the app download link (`APP_DOWNLOAD_URL`).',
  'POST /auth/otp/request': '`{ phone }` → sends a 6-digit OTP (printed to the console in demo; `demoCode` returned in demo). 30 s resend cooldown, 6/hour.',
  'POST /auth/otp/verify': '`{ phone, code }` → existing user: `{ isNewUser: false, user, tokens }`; new number: `{ isNewUser: true, signupToken }`.',
  'POST /auth/register/phone': '`{ signupToken, name, dob, acceptTerms }` → `{ user, tokens }`. Under-18 refused.',
  'POST /auth/register/email': '`{ email, password, name, dob, acceptTerms }` → `{ user, tokens }`.',
  'POST /auth/login/email': '`{ email, password }` → `{ user, tokens }`.',
  'POST /auth/password/forgot': '`{ email }` → emails a reset code (same response whether or not the email exists).',
  'POST /auth/password/reset': '`{ email, code, password }` → sets a new password and signs out other sessions.',
  'POST /auth/refresh': '`{ refreshToken }` → new `{ user, tokens }`; keeps the session scope (app/admin).',
  'POST /auth/logout-all': 'Revokes every session of the current user.',
  'GET /me': 'Current user profile and settings (`UserDto`).',
  'PATCH /me': '`{ name?, city?, favouriteTeam?, state? }` — `state` is an Indian state code, needed for real money.',
  'PATCH /me/settings': 'Notification, haptics and language preferences.',
  'POST /me/avatar': 'Multipart `avatar` (JPG/PNG/WEBP ≤ 5 MB, type checked from file bytes).',
  'DELETE /me/avatar': 'Remove the profile photo.',
  'GET /me/contests': 'Contest history: every entry with points, rank and winnings (`?limit&cursor`).',
  'GET /me/stats': 'Lifetime stats and best-team points for the last 10 completed matches.',
  'GET /sports': 'Sports and whether each is enabled.',
  'GET /matches': 'Matches by `?sport&status&limit&cursor`.',
  'GET /matches/:id': 'Match detail with squads and lineups.',
  'GET /fantasy/rules': 'Team rules for `?sport` (size, credits, role limits, multipliers).',
  'GET /matches/:id/builder': 'Everything the team builder needs: squads with credits, rules and the caller’s teams.',
  'GET /teams/:id': 'One of the caller’s teams.',
  'POST /teams': '`{ matchId, playerIds[11], captainId, viceCaptainId }` → validated team (deadline, credits, roles, duplicates, 6-team limit).',
  'PUT /teams/:id': 'Edit a team before the deadline (same validation).',
  'GET /matches/:id/contests': 'Open contests for a match with the caller’s entry counts.',
  'GET /contests/:id': 'Contest detail: prizes, leaderboard, the caller’s entries.',
  'POST /contests/:id/join': '`{ teamIds[], inviteCode? }` — locks the contest row; charges the wallet for paid contests (geo-checked).',
  'PUT /contests/:id/entries/:entryId': '`{ teamId }` — switch which team an entry uses, before the deadline.',
  'POST /contests/private': 'Create a private contest and join with a team; returns the invite code.',
  'GET /me/matches': 'Matches the caller has teams/entries in, by `?status`.',
  'GET /pay/:id': 'Hosted Razorpay checkout page (`?t=` checkout token). Strict per-page CSP with a nonce.',
  'POST /payments/razorpay/complete': 'Checkout callback: verifies the payment signature, then credits (idempotent with the webhook).',
  'GET /wallet': 'Balances per currency and bucket, limits, KYC status, whether deposits/withdrawals are enabled.',
  'GET /wallet/transactions': 'Transaction history (`?limit&cursor`).',
  'POST /wallet/deposits': '`{ amount }` → Razorpay order + checkout URL. Real money only; deposit limits and geo-blocking apply.',
  'POST /wallet/withdrawals': '`{ amount }` → holds winnings for approval; TDS on net winnings is withheld. Needs verified KYC.',
  'GET /me/kyc': 'KYC status (`NOT_STARTED | PENDING | VERIFIED | REJECTED`) with the masked PAN.',
  'POST /me/kyc': '`{ fullName, pan }` — stored masked + peppered hash; a PAN on another account is refused.',
  'GET /notifications': 'Notification centre (`?limit&cursor`) with the unread count.',
  'GET /notifications/unread-count': '`{ unread }` for the bell badge.',
  'POST /notifications/read': '`{ ids: [] }` or `{ all: true }`.',
  'POST /me/push-tokens': '`{ token, kind: EXPO|FCM, platform }` — registers this device for push.',
  'DELETE /me/push-tokens': '`{ token }` — unregisters (on logout).',
  'GET /support/tickets': 'The caller’s support requests.',
  'GET /support/tickets/:id': 'A request with its message thread.',
  'POST /support/tickets': '`{ category, subject, message }` — max 5 open per user.',
  'POST /support/tickets/:id/messages': '`{ message }` — reply (re-opens a resolved request).',
  'GET /me/responsible-play': 'Status, deposit limits, pending increases, usage and break end.',
  'PUT /me/responsible-play/limits': '`{ daily, weekly, monthly }` (₹ or null) — decreases now, increases after 24 h.',
  'DELETE /me/responsible-play/limits/pending': 'Cancel a pending increase.',
  'POST /me/responsible-play/break': '`{ days: 1|7|30|90|180|365 }` — self-exclusion; can’t be shortened.',
  'POST /admin/auth/login': '`{ email, password }` → admin session, or `{ mfaRequired: true, challenge }` when 2FA is on.',
  'POST /admin/auth/mfa': '`{ challenge, code }` → admin session with 2FA verified.',
  'GET /admin/auth/me': 'Staff profile, role, permissions and 2FA state.',
  'POST /admin/auth/mfa/setup': 'Start 2FA enrolment → `{ secret, otpauthUrl }` (show as a QR code).',
  'POST /admin/auth/mfa/enable': '`{ code }` → turns 2FA on, signs out other sessions, returns an upgraded session.',
  'POST /admin/auth/reauth': '`{ password }` or `{ code }` → `{ reauthToken, expiresIn: 300 }` for step-up actions.',
  'GET /admin/overview': 'Dashboard numbers, queues and the 14-day sign-up series.',
  'GET /admin/users': 'Search users (`?q&status&role=USER|STAFF&cursor`).',
  'GET /admin/users/:id': 'Full profile: balances, transactions, entries, risk flags and audit trail.',
  'POST /admin/users/:id/restrict': '`{ reason }` — block play (the user sees the reason).',
  'POST /admin/users/:id/unrestrict': 'Re-activate a restricted or suspended user.',
  'POST /admin/users/:id/role': '`{ role }` — change role (ends the user’s sessions; at least one super admin must remain).',
  'GET /admin/matches': 'Matches by `?status&q`.',
  'GET /admin/matches/:id': 'Match with live state and all contests.',
  'POST /admin/matches/:id/abandon': '`{ reason }` — mark abandoned; cancels and refunds every contest.',
  'POST /admin/matches/sync': 'Run the sports-data sync now.',
  'GET /admin/players': 'Players by `?q`, with credits and roles.',
  'GET /admin/config/scoring': 'Scoring tables per sport and format.',
  'PUT /admin/config/scoring/:id': 'Replace a scoring table (validated); applies from the next live update.',
  'GET /admin/config/fantasy': 'Team rules per sport.',
  'PUT /admin/config/fantasy/:sportId': 'Replace team rules (validated so a full team is always possible).',
  'GET /admin/contests': 'Contests by `?status&type&matchId&q`.',
  'POST /admin/contests': 'Create a FREE / PRACTICE / PUBLIC (paid, real money only) contest with a prize breakup.',
  'POST /admin/contests/:id/cancel': '`{ reason }` — cancel an open or running contest with refunds.',
  'GET /admin/transactions': 'Ledger transactions by `?type&status&userId&q`.',
  'GET /admin/withdrawals': 'Pending withdrawals with KYC details.',
  'POST /admin/withdrawals/:id/approve': 'Pay out (not your own). TDS stays withheld.',
  'POST /admin/withdrawals/:id/reject': '`{ reason }` — return the full amount to winnings.',
  'GET /admin/kyc': 'KYC queue by `?status`, flags PANs used on other accounts.',
  'POST /admin/kyc/:userId/review': '`{ approve, note? }` — verify or reject (note required); notifies the user.',
  'GET /admin/tickets': 'Support inbox (oldest waiting first) by `?status&type&q`.',
  'GET /admin/tickets/:id': 'Ticket with the full thread and staff names.',
  'POST /admin/tickets/:id/reply': '`{ message, status }` — reply and set the next status; notifies the user.',
  'POST /admin/tickets/:id/status': '`{ status }` — change status without replying.',
  'GET /admin/risk': 'Risk flags by `?status&type&userId`.',
  'POST /admin/risk/scan': 'Run the risk scanner now; returns new flags per kind.',
  'POST /admin/risk/:id/resolve': '`{ status: DISMISSED|ACTIONED, note }`.',
  'GET /admin/announcements': 'Sent announcements with recipient counts.',
  'GET /admin/audit': 'Audit log by `?action` (prefix) `&userId&q`.',
};

const routes = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // Split into classes so each method knows its controller prefix.
  const classRe = /((?:@[\w.]+\([^)]*\)\s*)*)export class (\w+)/g;
  const classes = [...src.matchAll(classRe)].map((m) => ({ decorators: m[1], name: m[2], index: m.index }));
  classes.forEach((c, i) => {
    const ctrl = /@Controller\(\s*'([^']*)'\s*\)|@Controller\(\)|@AdminController\(\s*'([^']*)'\s*\)/.exec(c.decorators);
    if (!ctrl) return;
    const base = ctrl[2] !== undefined ? `admin/${ctrl[2]}` : (ctrl[1] ?? '');
    const classPublic = /@Public\(\)/.test(c.decorators);
    const isAdmin = /@AdminController/.test(c.decorators) || base.startsWith('admin');
    const body = src.slice(c.index, classes[i + 1]?.index ?? src.length);
    // Decorator arguments may nest calls three deep, e.g. @UseInterceptors(FileInterceptor('x', { storage: memoryStorage() })).
    const args = String.raw`\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*\)`;
    const methodRe = new RegExp(String.raw`((?:\s*\/\*\*[\s\S]*?\*\/)?(?:\s*@\w+${args})+)\s*(?:async\s+)?(\w+)\s*\(`, 'g');
    for (const m of body.matchAll(methodRe)) {
      const block = m[1];
      const verb = /@(Get|Post|Put|Patch|Delete)\((?:\s*'([^']*)')?\s*\)/.exec(block);
      if (!verb) continue;
      const path = '/' + [base, verb[2] ?? ''].filter(Boolean).join('/');
      const doc = /\/\*\*([\s\S]*?)\*\//.exec(block)?.[1].replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim() ?? '';
      const perms = /@Perm\(([^)]*)\)/.exec(block)?.[1].replace(/'/g, '').replace(/\s/g, '') ?? '';
      const throttle = /@Throttle\(\s*\{\s*default:\s*\{\s*limit:\s*(\d+),\s*ttl:\s*([\d_]+)/.exec(block);
      // Named limits (e.g. @Throttle(STRICT)) are resolved from the constant in the same file.
      const limitName = /@Throttle\((\w+)\)/.exec(block)?.[1];
      const limitDef = limitName ? new RegExp(`const ${limitName} = \\{ default: \\{ limit: (\\d+), ttl: ([\\d_]+)`).exec(src) : null;
      const limitVar = limitDef ? `${limitDef[1]}/${Math.round(Number(limitDef[2].replace(/_/g, '')) / 60000)}min` : limitName;
      let auth = classPublic || /@Public\(\)/.test(block) ? 'public' : isAdmin ? 'admin' : 'user';
      if (/@UseGuards\(AdminGuard\)/.test(block)) auth = 'admin';
      routes.push({
        file: relative(SRC, file).replace(/\\/g, '/'),
        method: verb[1].toUpperCase(),
        path,
        auth,
        perms,
        sensitive: /@Sensitive\(\)/.test(block),
        noMfa: /@AllowWithoutMfa\(\)/.test(block),
        limit: throttle ? `${throttle[1]}/${Math.round(Number(throttle[2].replace(/_/g, '')) / 60000)}min` : limitVar ? limitVar : /@SkipThrottle/.test(block) ? 'none' : '',
        doc,
        handler: m[2],
      });
    }
  });
}

const authLabel = (r) => (r.auth === 'public' ? 'Public' : r.auth === 'user' ? 'User' : `Staff${r.perms ? ` · \`${r.perms}\`` : ''}${r.sensitive ? ' · **step-up**' : ''}${r.noMfa ? ' · before 2FA' : ''}`);

let md = `# API reference

> Generated by \`npm run docs:api\` from the controllers in \`apps/api/src\` — ${routes.length} routes. Request and response shapes are the zod schemas and DTO types in \`packages/shared\`.

## Conventions

- **Base URL:** \`PUBLIC_API_URL\` (local: \`http://localhost:4000\`). JSON in and out; bodies are limited to 100 kB.
- **Auth:** \`Authorization: Bearer <accessToken>\`. Access tokens last 15 minutes; refresh with \`POST /auth/refresh\` (refresh tokens rotate on every use, and replaying an old one revokes the session family).
  - **Public** — no token. **User** — any signed-in account. **Staff** — an *admin-panel* session from \`/admin/auth/*\` with the listed permission (see \`packages/shared/src/admin.ts\`); app sessions are refused.
  - **step-up** — also send \`x-reauth-token\` from \`POST /admin/auth/reauth\` (valid 5 minutes, bound to the staff member).
- **Errors** always look like \`{ statusCode, error, message, fields?, code? }\`. \`fields\` maps input paths to messages (validation); \`code\` is machine-readable (\`REAUTH_REQUIRED\`, \`MFA_REQUIRED\`, \`ADMIN_SESSION_REQUIRED\`, \`FORBIDDEN_ROLE\`, \`STATE_REQUIRED\`, \`GEO_BLOCKED\`).
- **Rate limits:** 120 requests/minute per IP by default; tighter limits are listed per route (\`limit/window\`). \`429\` when exceeded.
- **Pagination:** list endpoints take \`limit\` and \`cursor\` and return \`{ items, nextCursor }\`.
- **Money** is in rupees (or demo credits) with up to 2 decimals; the database stores ×100 integers.
- **Real time:** Socket.IO namespace \`/live\` with \`auth: { token }\`. Emit \`subscribe\` with \`match:<id>\` or \`contest:<id>\`. Events: \`match:live\`, \`leaderboard:delta\`, \`contest:status\`, and \`notification:new\` on the private user room (joined automatically).

`;

for (const [title, re] of GROUPS) {
  const list = routes.filter((r) => re.test(r.file));
  if (!list.length) continue;
  md += `## ${title}\n\n| Method | Path | Auth | Limit | Description |\n| --- | --- | --- | --- | --- |\n`;
  for (const r of list) md += `| ${r.method} | \`${r.path}\` | ${authLabel(r)} | ${r.limit || '—'} | ${r.doc || DESCRIPTIONS[`${r.method} ${r.path}`] || r.handler} |\n`;
  md += '\n';
}
const ungrouped = routes.filter((r) => !GROUPS.some(([, re]) => re.test(r.file)));
if (ungrouped.length) throw new Error(`Routes without a docs group: ${ungrouped.map((r) => r.file).join(', ')}`);

writeFileSync(join(ROOT, 'docs/API.md'), md);
console.log(`docs/API.md: ${routes.length} routes`);
