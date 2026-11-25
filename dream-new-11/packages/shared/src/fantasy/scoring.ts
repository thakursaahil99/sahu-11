import type { PlayerRole } from '../types/sports';

/** One player's real-match numbers. Everything defaults to 0 / false. */
export interface PlayerMatchStats {
  inPlayingXI: boolean;
  // batting
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  /** Batted and was dismissed (needed for ducks). */
  out: boolean;
  // bowling
  ballsBowled: number;
  runsConceded: number;
  wickets: number;
  /** Wickets that were bowled or LBW (bonus on top of the wicket). */
  lbwBowled: number;
  maidens: number;
  // fielding
  catches: number;
  stumpings: number;
  runOutDirect: number;
  runOutIndirect: number;
}

export const emptyStats = (): PlayerMatchStats => ({
  inPlayingXI: false,
  runs: 0,
  balls: 0,
  fours: 0,
  sixes: 0,
  out: false,
  ballsBowled: 0,
  runsConceded: 0,
  wickets: 0,
  lbwBowled: 0,
  maidens: 0,
  catches: 0,
  stumpings: 0,
  runOutDirect: 0,
  runOutIndirect: 0,
});

/** A half-open band: applies when min <= value < max (either bound may be omitted). */
export interface Slab {
  min?: number;
  max?: number;
  points: number;
}

/** Points table. Stored per sport + format in ScoringConfig and editable by admins. */
export interface ScoringRules {
  playing: number;
  run: number;
  boundaryBonus: number;
  sixBonus: number;
  /** Bonus at each milestone: e.g. { 30: 4, 50: 8, 100: 16 } — only the highest reached counts. */
  battingMilestones: Record<string, number>;
  duck: number;
  wicket: number;
  lbwBowledBonus: number;
  /** Highest reached counts: e.g. { 3: 4, 4: 8, 5: 16 }. */
  wicketHauls: Record<string, number>;
  maiden: number;
  catch: number;
  threeCatchBonus: number;
  stumping: number;
  runOutDirect: number;
  runOutIndirect: number;
  economy: { minBalls: number; slabs: Slab[] };
  strikeRate: { minBalls: number; slabs: Slab[] };
}

export const DEFAULT_T20_SCORING: ScoringRules = {
  playing: 4,
  run: 1,
  boundaryBonus: 1,
  sixBonus: 2,
  battingMilestones: { 30: 4, 50: 8, 100: 16 },
  duck: -2,
  wicket: 25,
  lbwBowledBonus: 8,
  wicketHauls: { 3: 4, 4: 8, 5: 16 },
  maiden: 12,
  catch: 8,
  threeCatchBonus: 4,
  stumping: 12,
  runOutDirect: 12,
  runOutIndirect: 6,
  economy: {
    minBalls: 12,
    slabs: [
      { max: 5, points: 6 },
      { min: 5, max: 6, points: 4 },
      { min: 6, max: 7, points: 2 },
      { min: 10, max: 11, points: -2 },
      { min: 11, max: 12, points: -4 },
      { min: 12, points: -6 },
    ],
  },
  strikeRate: {
    minBalls: 10,
    slabs: [
      { min: 170, points: 6 },
      { min: 150, max: 170, points: 4 },
      { min: 130, max: 150, points: 2 },
      { min: 60, max: 70, points: -2 },
      { min: 50, max: 60, points: -4 },
      { max: 50, points: -6 },
    ],
  },
};

/** T10 uses the same points with stricter economy and strike-rate thresholds. */
export const DEFAULT_T10_SCORING: ScoringRules = {
  ...DEFAULT_T20_SCORING,
  battingMilestones: { 30: 8, 50: 16 },
  wicketHauls: { 2: 8, 3: 16 },
  economy: {
    minBalls: 6,
    slabs: [
      { max: 7, points: 6 },
      { min: 7, max: 8, points: 4 },
      { min: 8, max: 9, points: 2 },
      { min: 14, max: 15, points: -2 },
      { min: 15, max: 16, points: -4 },
      { min: 16, points: -6 },
    ],
  },
  strikeRate: {
    minBalls: 5,
    slabs: [
      { min: 190, points: 6 },
      { min: 170, max: 190, points: 4 },
      { min: 150, max: 170, points: 2 },
      { min: 70, max: 80, points: -2 },
      { min: 60, max: 70, points: -4 },
      { max: 60, points: -6 },
    ],
  },
};

export const defaultScoringFor = (format: string): ScoringRules => (format.toUpperCase() === 'T10' ? DEFAULT_T10_SCORING : DEFAULT_T20_SCORING);

export type ScoreKey =
  | 'playing'
  | 'runs'
  | 'boundaries'
  | 'sixes'
  | 'milestone'
  | 'duck'
  | 'strikeRate'
  | 'wickets'
  | 'lbwBowled'
  | 'wicketHaul'
  | 'maidens'
  | 'economy'
  | 'catches'
  | 'catchBonus'
  | 'stumpings'
  | 'runOutDirect'
  | 'runOutIndirect';

export interface ScoreLine {
  key: ScoreKey;
  label: string;
  /** The stat behind the line, e.g. "42 runs" or "Econ 6.50". */
  detail: string;
  points: number;
}

export interface PlayerScore {
  total: number;
  lines: ScoreLine[];
}

const slabPoints = (slabs: Slab[], value: number) =>
  slabs.find((s) => (s.min === undefined || value >= s.min) && (s.max === undefined || value < s.max))?.points ?? 0;

/** Highest threshold reached in a { threshold: points } table. */
function highestTier(table: Record<string, number>, value: number): { at: number; points: number } | null {
  let best: { at: number; points: number } | null = null;
  for (const [k, pts] of Object.entries(table)) {
    const at = Number(k);
    if (value >= at && (!best || at > best.at)) best = { at, points: pts };
  }
  return best;
}

/** Base fantasy points for one player (before captain / vice-captain multipliers). */
export function scorePlayer(s: PlayerMatchStats, role: PlayerRole, rules: ScoringRules): PlayerScore {
  const lines: ScoreLine[] = [];
  const add = (key: ScoreKey, label: string, detail: string, points: number) => {
    if (points !== 0) lines.push({ key, label, detail, points });
  };
  if (!s.inPlayingXI) return { total: 0, lines };

  add('playing', 'In playing XI', '', rules.playing);

  // Batting
  add('runs', 'Runs', `${s.runs} runs`, s.runs * rules.run);
  add('boundaries', 'Boundary bonus', `${s.fours} fours`, s.fours * rules.boundaryBonus);
  add('sixes', 'Six bonus', `${s.sixes} sixes`, s.sixes * rules.sixBonus);
  const milestone = highestTier(rules.battingMilestones, s.runs);
  if (milestone) add('milestone', `${milestone.at}+ runs bonus`, `${s.runs} runs`, milestone.points);
  if (role !== 'BOWL' && s.out && s.runs === 0 && s.balls > 0) add('duck', 'Duck', 'Out for 0', rules.duck);
  if (role !== 'BOWL' && s.balls >= rules.strikeRate.minBalls) {
    const sr = (s.runs / s.balls) * 100;
    add('strikeRate', 'Strike rate', `SR ${sr.toFixed(1)}`, slabPoints(rules.strikeRate.slabs, sr));
  }

  // Bowling
  add('wickets', 'Wickets', `${s.wickets} wkts`, s.wickets * rules.wicket);
  add('lbwBowled', 'Bowled / LBW bonus', `${s.lbwBowled} bowled/LBW`, s.lbwBowled * rules.lbwBowledBonus);
  const haul = highestTier(rules.wicketHauls, s.wickets);
  if (haul) add('wicketHaul', `${haul.at}-wicket haul`, `${s.wickets} wkts`, haul.points);
  add('maidens', 'Maidens', `${s.maidens} maidens`, s.maidens * rules.maiden);
  if (s.ballsBowled >= rules.economy.minBalls) {
    const econ = (s.runsConceded / s.ballsBowled) * 6;
    add('economy', 'Economy', `Econ ${econ.toFixed(2)}`, slabPoints(rules.economy.slabs, econ));
  }

  // Fielding
  add('catches', 'Catches', `${s.catches} catches`, s.catches * rules.catch);
  if (s.catches >= 3) add('catchBonus', '3-catch bonus', `${s.catches} catches`, rules.threeCatchBonus);
  add('stumpings', 'Stumpings', `${s.stumpings} stumpings`, s.stumpings * rules.stumping);
  add('runOutDirect', 'Run out (direct)', `${s.runOutDirect}`, s.runOutDirect * rules.runOutDirect);
  add('runOutIndirect', 'Run out (assist)', `${s.runOutIndirect}`, s.runOutIndirect * rules.runOutIndirect);

  return { total: lines.reduce((sum, l) => sum + l.points, 0), lines };
}

/**
 * Team points ×10 (integers; a vice-captain's 1.5x can create halves).
 * `base` maps playerId → base points.
 */
export function teamPointsX10(
  playerIds: string[],
  captainId: string,
  viceCaptainId: string,
  base: Map<string, number>,
  captainMultiplier: number,
  viceCaptainMultiplier: number,
): number {
  let total = 0;
  for (const id of playerIds) {
    const pts = base.get(id) ?? 0;
    const mult = id === captainId ? captainMultiplier : id === viceCaptainId ? viceCaptainMultiplier : 1;
    total += Math.round(pts * mult * 10);
  }
  return total;
}
