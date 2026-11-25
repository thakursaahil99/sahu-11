import { z } from 'zod';
import type { UserRole } from './constants';
import { validateBreakup } from './fantasy/prizes';

// ─── RBAC ───────────────────────────────────────────────────────────────────

export const ADMIN_PERMISSIONS = [
  'dashboard.view',
  'users.view',
  'users.restrict',
  'users.roles',
  'kyc.review',
  'finance.view',
  'withdrawals.approve',
  'matches.manage',
  'players.manage',
  'sports.sync',
  'scoring.edit',
  'fantasy.edit',
  'contests.manage',
  'support.reply',
  'risk.review',
  'announcements.send',
  'audit.view',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const STAFF_ROLES = ['SUPER_ADMIN', 'CONTENT_ADMIN', 'SUPPORT', 'FINANCE'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const isStaff = (role: UserRole): role is StaffRole => (STAFF_ROLES as readonly string[]).includes(role);

/** What each staff role may do. SUPER_ADMIN has everything. */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,
  CONTENT_ADMIN: ['dashboard.view', 'matches.manage', 'players.manage', 'sports.sync', 'scoring.edit', 'fantasy.edit', 'contests.manage', 'announcements.send'],
  SUPPORT: ['dashboard.view', 'users.view', 'users.restrict', 'support.reply', 'risk.review'],
  FINANCE: ['dashboard.view', 'users.view', 'kyc.review', 'finance.view', 'withdrawals.approve', 'risk.review', 'audit.view'],
};

export const can = (role: UserRole, p: AdminPermission) => isStaff(role) && ROLE_PERMISSIONS[role].includes(p);

export const ROLE_LABEL: Record<UserRole, string> = {
  USER: 'Player',
  SUPER_ADMIN: 'Super admin',
  CONTENT_ADMIN: 'Content admin',
  SUPPORT: 'Support',
  FINANCE: 'Finance',
};

/** Header carrying a step-up token for sensitive actions. */
export const REAUTH_HEADER = 'x-reauth-token';

// ─── Auth ───────────────────────────────────────────────────────────────────

export const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const mfaVerifySchema = z.object({ challenge: z.string().min(10), code: totpCodeSchema });
export const mfaEnableSchema = z.object({ code: totpCodeSchema });
export const reauthSchema = z.object({ password: z.string().min(1).optional(), code: totpCodeSchema.optional() }).refine((v) => v.password || v.code, 'Enter your password or code');

export interface AdminMe {
  id: string;
  name: string;
  email: string | null;
  role: StaffRole;
  permissions: AdminPermission[];
  mfaEnabled: boolean;
  /** This session passed 2FA. */
  mfaVerified: boolean;
  /** Policy: staff must use 2FA (always on in production). */
  mfaRequired: boolean;
}

export interface AdminSession {
  me: AdminMe;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
}

export type AdminLoginResult = { mfaRequired: true; challenge: string } | ({ mfaRequired: false } & AdminSession);

// ─── Actions ────────────────────────────────────────────────────────────────

const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);

export const restrictUserSchema = z.object({ reason });
export const changeRoleSchema = z.object({ role: z.enum(['USER', ...STAFF_ROLES]) });
export const kycReviewSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }).refine((v) => v.approve || (v.note && v.note.length >= 5), {
  message: 'Tell the user what to fix',
  path: ['note'],
});
export const withdrawalRejectSchema = z.object({ reason });
export const cancelSchema = z.object({ reason });

export const playerUpdateSchema = z.object({
  credits: z
    .number()
    .min(4, 'At least 4 credits')
    .max(12, 'At most 12 credits')
    .refine((v) => Math.round(v * 2) === v * 2, 'Use steps of 0.5')
    .optional(),
  role: z.enum(['WK', 'BAT', 'AR', 'BOWL']).optional(),
});

const tier = z.object({ fromRank: z.number().int().min(1), toRank: z.number().int().min(1), amount: z.number().min(0) });
export const adminContestSchema = z
  .object({
    matchId: z.string().min(1, 'Choose a match'),
    name: z.string().trim().min(3, 'Name needs at least 3 characters').max(60, 'Keep the name under 60 characters'),
    type: z.enum(['PUBLIC', 'FREE', 'PRACTICE']),
    entryFee: z.number().min(0, 'Can’t be negative').max(100_000, 'At most ₹1,00,000'),
    prizePool: z.number().min(0, 'Can’t be negative').max(100_000_000, 'Too large'),
    totalSpots: z.number().int('Whole number').min(2, 'At least 2 spots').max(1_000_000, 'At most 10,00,000 spots'),
    maxEntriesPerUser: z.number().int('Whole number').min(1, 'At least 1').max(20, 'At most 20'),
    guaranteed: z.boolean(),
    prizeBreakup: z.array(tier).max(50),
  })
  .superRefine((v, ctx) => {
    if (v.type !== 'PUBLIC' && v.entryFee > 0) ctx.addIssue({ code: 'custom', path: ['entryFee'], message: 'Only paid (public) contests have an entry fee' });
    if (v.type === 'PUBLIC' && v.entryFee <= 0) ctx.addIssue({ code: 'custom', path: ['entryFee'], message: 'Paid contests need an entry fee' });
    if (v.type === 'PRACTICE' && (v.prizePool > 0 || v.prizeBreakup.length)) ctx.addIssue({ code: 'custom', path: ['prizePool'], message: 'Practice contests have no prizes' });
    const err = validateBreakup(v.prizeBreakup, v.prizePool, v.totalSpots);
    if (err) ctx.addIssue({ code: 'custom', path: ['prizeBreakup'], message: err });
  });
export type AdminContestInput = z.infer<typeof adminContestSchema>;

const slab = z.object({ min: z.number().optional(), max: z.number().optional(), points: z.number() });
const pointsMap = z.record(z.string().regex(/^\d+$/), z.number());
export const scoringRulesSchema = z.object({
  playing: z.number(),
  run: z.number(),
  boundaryBonus: z.number(),
  sixBonus: z.number(),
  battingMilestones: pointsMap,
  duck: z.number(),
  wicket: z.number(),
  lbwBowledBonus: z.number(),
  wicketHauls: pointsMap,
  maiden: z.number(),
  catch: z.number(),
  threeCatchBonus: z.number(),
  stumping: z.number(),
  runOutDirect: z.number(),
  runOutIndirect: z.number(),
  economy: z.object({ minBalls: z.number().int().min(0), slabs: z.array(slab).max(12) }),
  strikeRate: z.object({ minBalls: z.number().int().min(0), slabs: z.array(slab).max(12) }),
});

const roleLimit = z.object({ min: z.number().int().min(0).max(11), max: z.number().int().min(0).max(11) });
export const fantasyRulesSchema = z
  .object({
    teamSize: z.number().int().min(5).max(15),
    maxCredits: z.number().min(50).max(200),
    maxPerTeam: z.number().int().min(1).max(15),
    roleLimits: z.object({ WK: roleLimit, BAT: roleLimit, AR: roleLimit, BOWL: roleLimit }),
    maxTeamsPerMatch: z.number().int().min(1).max(20),
    captainMultiplier: z.number().min(1).max(5),
    viceCaptainMultiplier: z.number().min(1).max(5),
  })
  .superRefine((v, ctx) => {
    const mins = Object.values(v.roleLimits).reduce((s, r) => s + r.min, 0);
    const maxs = Object.values(v.roleLimits).reduce((s, r) => s + r.max, 0);
    for (const [k, r] of Object.entries(v.roleLimits)) if (r.min > r.max) ctx.addIssue({ code: 'custom', path: ['roleLimits', k], message: `${k}: min is above max` });
    if (mins > v.teamSize || maxs < v.teamSize) ctx.addIssue({ code: 'custom', path: ['roleLimits'], message: 'Role limits can’t make a full team' });
    if (v.maxPerTeam * 2 < v.teamSize) ctx.addIssue({ code: 'custom', path: ['maxPerTeam'], message: 'Too low to pick a full team from two sides' });
  });

export const staffReplySchema = z.object({ message: z.string().trim().min(1).max(4000), status: z.enum(['AWAITING_USER', 'RESOLVED', 'CLOSED']) });
export const ticketStatusSchema = z.object({ status: z.enum(['OPEN', 'AWAITING_USER', 'RESOLVED', 'CLOSED']) });

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().min(5).max(240),
  url: z
    .string()
    .trim()
    .regex(/^\/[\w\-/?=&]*$/, 'Use an in-app path like /home or /match/abc')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  audience: z.enum(['ALL', 'ACTIVE_30D']),
  promotional: z.boolean(),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const riskResolveSchema = z.object({ status: z.enum(['DISMISSED', 'ACTIONED']), note: z.string().trim().min(3).max(300) });

export const adminListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.string().max(30).optional(),
  type: z.string().max(30).optional(),
  role: z.string().max(30).optional(),
  userId: z.string().max(40).optional(),
  matchId: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
  cursor: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
