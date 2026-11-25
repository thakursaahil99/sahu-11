import { PLAYER_ROLE_LABELS, PLAYER_ROLES, PlayerRole } from '../types/sports';

/** Team-building rules for one sport. Stored in FantasyConfig and editable by admins. */
export interface FantasyRules {
  teamSize: number;
  /** Total credit budget, e.g. 100. */
  maxCredits: number;
  /** Maximum players from one real team. */
  maxPerTeam: number;
  roleLimits: Record<PlayerRole, { min: number; max: number }>;
  maxTeamsPerMatch: number;
  captainMultiplier: number;
  viceCaptainMultiplier: number;
}

export const DEFAULT_CRICKET_RULES: FantasyRules = {
  teamSize: 11,
  maxCredits: 100,
  maxPerTeam: 7,
  roleLimits: { WK: { min: 1, max: 4 }, BAT: { min: 3, max: 6 }, AR: { min: 1, max: 4 }, BOWL: { min: 3, max: 6 } },
  maxTeamsPerMatch: 6,
  captainMultiplier: 2,
  viceCaptainMultiplier: 1.5,
};

/** The minimum a player needs for rule checks. */
export interface PickablePlayer {
  id: string;
  role: PlayerRole;
  credits: number;
  teamId: string;
}

export interface TeamSummary {
  count: number;
  /** Credits used, rounded to one decimal. */
  credits: number;
  creditsLeft: number;
  byRole: Record<PlayerRole, number>;
  byTeam: Record<string, number>;
}

// Credits are compared in tenths to avoid floating-point drift (8.5 + 9.5 + …).
const tenths = (n: number) => Math.round(n * 10);

export function summarizeTeam(picked: PickablePlayer[], rules: FantasyRules): TeamSummary {
  const byRole = { WK: 0, BAT: 0, AR: 0, BOWL: 0 } as Record<PlayerRole, number>;
  const byTeam: Record<string, number> = {};
  let credits = 0;
  for (const p of picked) {
    byRole[p.role] += 1;
    byTeam[p.teamId] = (byTeam[p.teamId] ?? 0) + 1;
    credits += tenths(p.credits);
  }
  return {
    count: picked.length,
    credits: credits / 10,
    creditsLeft: (tenths(rules.maxCredits) - credits) / 10,
    byRole,
    byTeam,
  };
}

/** Slots still needed to reach every role minimum. */
function slotsOwed(byRole: Record<PlayerRole, number>, rules: FantasyRules): number {
  return PLAYER_ROLES.reduce((sum, r) => sum + Math.max(0, rules.roleLimits[r].min - byRole[r]), 0);
}

const plural = (role: PlayerRole, n: number) => `${PLAYER_ROLE_LABELS[role].long}${n === 1 ? '' : 's'}`;

/**
 * Why `candidate` can't be added to `picked`, or null if it can. Includes the look-ahead
 * check: adding must still leave room to meet every other role's minimum.
 */
export function whyCannotAdd(picked: PickablePlayer[], candidate: PickablePlayer, rules: FantasyRules): string | null {
  if (picked.some((p) => p.id === candidate.id)) return 'Already in your team';
  const s = summarizeTeam(picked, rules);
  if (s.count >= rules.teamSize) return `You already have ${rules.teamSize} players`;

  const roleMax = rules.roleLimits[candidate.role].max;
  if (s.byRole[candidate.role] >= roleMax) return `You can pick at most ${roleMax} ${plural(candidate.role, roleMax)}`;

  if ((s.byTeam[candidate.teamId] ?? 0) >= rules.maxPerTeam) return `Max ${rules.maxPerTeam} players from one team`;

  if (tenths(candidate.credits) > tenths(s.creditsLeft)) return `Not enough credits (${s.creditsLeft} left)`;

  const after = { ...s.byRole, [candidate.role]: s.byRole[candidate.role] + 1 };
  const slotsLeft = rules.teamSize - (s.count + 1);
  if (slotsOwed(after, rules) > slotsLeft) {
    const short = PLAYER_ROLES.find((r) => after[r] < rules.roleLimits[r].min)!;
    const need = rules.roleLimits[short].min;
    return `You need at least ${need} ${plural(short, need)}`;
  }
  return null;
}

export type TeamRuleCode =
  | 'TEAM_SIZE'
  | 'DUPLICATE_PLAYER'
  | 'CREDITS'
  | 'MAX_PER_TEAM'
  | 'ROLE_MIN'
  | 'ROLE_MAX'
  | 'CAPTAIN'
  | 'VICE_CAPTAIN'
  | 'SAME_LEADER';

export interface TeamRuleError {
  code: TeamRuleCode;
  message: string;
}

export interface TeamDraft {
  players: PickablePlayer[];
  captainId: string | null;
  viceCaptainId: string | null;
}

/** Every rule violation in a complete team. Empty array means the team is valid. */
export function validateTeam(draft: TeamDraft, rules: FantasyRules): TeamRuleError[] {
  const errors: TeamRuleError[] = [];
  const ids = new Set(draft.players.map((p) => p.id));
  const s = summarizeTeam(draft.players, rules);

  if (ids.size !== draft.players.length) errors.push({ code: 'DUPLICATE_PLAYER', message: 'A player can only be picked once' });
  if (s.count !== rules.teamSize) errors.push({ code: 'TEAM_SIZE', message: `Pick exactly ${rules.teamSize} players (${s.count} selected)` });
  if (s.creditsLeft < 0) errors.push({ code: 'CREDITS', message: `Team uses ${s.credits} credits; the limit is ${rules.maxCredits}` });

  for (const n of Object.values(s.byTeam)) {
    if (n > rules.maxPerTeam) {
      errors.push({ code: 'MAX_PER_TEAM', message: `Max ${rules.maxPerTeam} players from one team (${n} picked from one side)` });
    }
  }
  for (const r of PLAYER_ROLES) {
    const { min, max } = rules.roleLimits[r];
    if (s.byRole[r] < min) errors.push({ code: 'ROLE_MIN', message: `Pick at least ${min} ${plural(r, min)}` });
    if (s.byRole[r] > max) errors.push({ code: 'ROLE_MAX', message: `Pick at most ${max} ${plural(r, max)}` });
  }

  if (!draft.captainId || !ids.has(draft.captainId)) errors.push({ code: 'CAPTAIN', message: 'Choose a captain from your team' });
  if (!draft.viceCaptainId || !ids.has(draft.viceCaptainId)) {
    errors.push({ code: 'VICE_CAPTAIN', message: 'Choose a vice-captain from your team' });
  }
  if (draft.captainId && draft.captainId === draft.viceCaptainId) {
    errors.push({ code: 'SAME_LEADER', message: 'Captain and vice-captain must be different players' });
  }
  return errors;
}

/** Order-independent fingerprint used to block saving two identical teams for one match. */
export function teamSignature(playerIds: string[], captainId: string, viceCaptainId: string): string {
  return `${[...playerIds].sort().join(',')}|C:${captainId}|VC:${viceCaptainId}`;
}
