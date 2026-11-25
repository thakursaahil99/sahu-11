import { emptyStats, PlayerMatchStats, PlayerRole } from '@dream11/shared';

/**
 * Deterministic ball-by-ball cricket simulator for demo mode.
 * `simulate` produces the whole match up front from a seed; `stateAt` replays the first N
 * deliveries, so "live" is simply how many deliveries the clock has reached.
 */

export interface SimPlayer {
  externalId: string;
  role: PlayerRole;
  /** 0–1 skill, used to bias outcomes. */
  quality: number;
}

export interface SimSide {
  teamExternalId: string;
  shortName: string;
  name: string;
  /** Playing XI in batting order. */
  xi: SimPlayer[];
}

type WicketKind = 'caught' | 'bowled' | 'lbw' | 'runout' | 'stumped';

export interface Delivery {
  inning: 0 | 1;
  bowler: string;
  striker: string;
  legal: boolean;
  wide: boolean;
  batterRuns: number;
  wicket: { kind: WicketKind; out: string; fielder?: string; direct?: boolean } | null;
}

export interface SimMatch {
  overs: number;
  /** [first innings batting side, second innings batting side] */
  order: [SimSide, SimSide];
  tossNote: string;
  deliveries: Delivery[];
  resultNote: string;
}

export interface InningsState {
  battingTeamExternalId: string;
  runs: number;
  wickets: number;
  balls: number;
  target: number | null;
}

export interface SimState {
  innings: InningsState[];
  recentBalls: string[];
  players: Record<string, PlayerMatchStats>;
  note: string;
  finished: boolean;
}

function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function pick<T>(r: () => number, items: T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

/** Plays a full limited-overs match. Pure function of its inputs. */
export function simulate(seed: string, overs: number, batFirst: SimSide, bowlFirst: SimSide, tossNote: string): SimMatch {
  const r = rng(`sim:${seed}`);
  const deliveries: Delivery[] = [];
  const maxPerBowler = Math.max(1, Math.floor(overs / 5));
  let firstInningsRuns = 0;

  for (const inning of [0, 1] as const) {
    const bat = inning === 0 ? batFirst : bowlFirst;
    const field = inning === 0 ? bowlFirst : batFirst;
    const target = inning === 1 ? firstInningsRuns + 1 : null;
    const keeper = field.xi.find((p) => p.role === 'WK') ?? field.xi[0]!;
    const bowlers = field.xi.filter((p) => p.role === 'BOWL' || p.role === 'AR');
    const oversBy = new Map<string, number>();

    let striker = 0;
    let nonStriker = 1;
    let nextIn = 2;
    let wickets = 0;
    let runs = 0;
    let lastBowler = '';

    for (let over = 0; over < overs && wickets < 10; over++) {
      const available = bowlers.filter((b) => b.externalId !== lastBowler && (oversBy.get(b.externalId) ?? 0) < maxPerBowler);
      const bowler = available.length ? available.sort((a, b) => b.quality - a.quality)[Math.floor(r() * Math.min(3, available.length))]! : pick(r, bowlers);
      oversBy.set(bowler.externalId, (oversBy.get(bowler.externalId) ?? 0) + 1);
      lastBowler = bowler.externalId;

      let legal = 0;
      while (legal < 6 && wickets < 10) {
        const batter = bat.xi[striker]!;
        if (r() < 0.03) {
          deliveries.push({ inning, bowler: bowler.externalId, striker: batter.externalId, legal: false, wide: true, batterRuns: 0, wicket: null });
          runs += 1;
          if (target && runs >= target) break;
          continue;
        }
        legal++;
        const edge = bowler.quality - batter.quality;
        const pWicket = clamp(0.045 + edge * 0.04 + (batter.role === 'BOWL' ? 0.04 : 0), 0.02, 0.12);
        const roll = r();
        if (roll < pWicket) {
          const k = r();
          const kind: WicketKind = k < 0.58 ? 'caught' : k < 0.74 ? 'bowled' : k < 0.86 ? 'lbw' : k < 0.95 ? 'runout' : 'stumped';
          const fieldersPool = field.xi.filter((p) => p.externalId !== bowler.externalId);
          const fielder = kind === 'stumped' ? keeper : kind === 'caught' && r() < 0.15 ? keeper : kind === 'caught' || kind === 'runout' ? pick(r, fieldersPool) : undefined;
          deliveries.push({
            inning,
            bowler: bowler.externalId,
            striker: batter.externalId,
            legal: true,
            wide: false,
            batterRuns: 0,
            wicket: { kind, out: batter.externalId, fielder: fielder?.externalId, direct: kind === 'runout' ? r() < 0.5 : undefined },
          });
          wickets++;
          if (wickets < 10) striker = nextIn++;
        } else {
          const boost = batter.quality * 0.06;
          const x = r();
          // Roughly T20-like: ~36% dots, ~38% singles, 8% twos, 12% fours, 5% sixes (better batters score faster).
          const batterRuns = x < 0.36 - boost ? 0 : x < 0.72 - boost ? 1 : x < 0.8 ? 2 : x < 0.805 ? 3 : x < 0.925 ? 4 : x < 0.975 ? 6 : 1;
          deliveries.push({ inning, bowler: bowler.externalId, striker: batter.externalId, legal: true, wide: false, batterRuns, wicket: null });
          runs += batterRuns;
          if (batterRuns % 2 === 1) [striker, nonStriker] = [nonStriker, striker];
        }
        if (target && runs >= target) break;
      }
      if (target && runs >= target) break;
      [striker, nonStriker] = [nonStriker, striker];
    }
    if (inning === 0) firstInningsRuns = runs;
  }

  const final = replay(deliveries, [batFirst, bowlFirst]);
  const [i1, i2] = final.innings;
  const resultNote =
    i2!.runs > i1!.runs
      ? `${bowlFirst.name} won by ${10 - i2!.wickets} wickets`
      : i2!.runs < i1!.runs
        ? `${batFirst.name} won by ${i1!.runs - i2!.runs} runs`
        : 'Match tied';
  return { overs, order: [batFirst, bowlFirst], tossNote, deliveries, resultNote };
}

const oversText = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

function replay(deliveries: Delivery[], order: [SimSide, SimSide]) {
  const players: Record<string, PlayerMatchStats> = {};
  for (const side of order) for (const p of side.xi) players[p.externalId] = { ...emptyStats(), inPlayingXI: true };
  const innings: InningsState[] = [];
  const overRuns = new Map<string, { bowler: string; runs: number; legal: number }>();
  const maidensCounted = new Set<string>();

  for (const d of deliveries) {
    if (!innings[d.inning]) {
      innings[d.inning] = {
        battingTeamExternalId: order[d.inning].teamExternalId,
        runs: 0,
        wickets: 0,
        balls: 0,
        target: d.inning === 1 ? innings[0]!.runs + 1 : null,
      };
    }
    const inn = innings[d.inning]!;
    const bat = players[d.striker]!;
    const bowl = players[d.bowler]!;
    const overKey = `${d.inning}:${Math.floor(inn.balls / 6)}`;
    const ov = overRuns.get(overKey) ?? { bowler: d.bowler, runs: 0, legal: 0 };

    if (d.wide) {
      inn.runs += 1;
      bowl.runsConceded += 1;
      ov.runs += 1;
    } else {
      inn.balls += 1;
      bat.balls += 1;
      bowl.ballsBowled += 1;
      ov.legal += 1;
      inn.runs += d.batterRuns;
      bat.runs += d.batterRuns;
      bowl.runsConceded += d.batterRuns;
      ov.runs += d.batterRuns;
      if (d.batterRuns === 4) bat.fours += 1;
      if (d.batterRuns === 6) bat.sixes += 1;
    }
    if (d.wicket) {
      inn.wickets += 1;
      players[d.wicket.out]!.out = true;
      const w = d.wicket;
      if (w.kind !== 'runout') bowl.wickets += 1;
      if (w.kind === 'bowled' || w.kind === 'lbw') bowl.lbwBowled += 1;
      if (w.fielder) {
        const f = players[w.fielder]!;
        if (w.kind === 'caught') f.catches += 1;
        if (w.kind === 'stumped') f.stumpings += 1;
        if (w.kind === 'runout') w.direct ? (f.runOutDirect += 1) : (f.runOutIndirect += 1);
      }
    }
    overRuns.set(overKey, ov);
    if (ov.legal === 6 && ov.runs === 0 && !maidensCounted.has(overKey)) {
      players[ov.bowler]!.maidens += 1;
      maidensCounted.add(overKey);
    }
  }
  return { innings, players };
}

const ballLabel = (d: Delivery) => (d.wide ? 'Wd' : d.wicket ? 'W' : d.batterRuns === 0 ? '•' : String(d.batterRuns));

/** Match state after the first `n` deliveries. */
export function stateAt(sim: SimMatch, n: number): SimState {
  const count = Math.max(0, Math.min(n, sim.deliveries.length));
  const played = sim.deliveries.slice(0, count);
  const { innings, players } = replay(played, sim.order);
  const finished = count >= sim.deliveries.length;

  let note = sim.tossNote;
  const cur = innings[innings.length - 1];
  if (finished) note = sim.resultNote;
  else if (cur) {
    const side = sim.order[innings.length - 1]!;
    note =
      cur.target !== null
        ? `${side.shortName} need ${Math.max(0, cur.target - cur.runs)} off ${sim.overs * 6 - cur.balls} balls`
        : `${side.shortName} ${cur.runs}/${cur.wickets} (${oversText(cur.balls)} ov)`;
  }
  return { innings, recentBalls: played.slice(-6).map(ballLabel), players, note, finished };
}
