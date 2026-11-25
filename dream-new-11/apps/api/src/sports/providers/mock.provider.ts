import type { MatchStatus, PlayerRole, PlayerStatsDto } from '@dream11/shared';
import { SimMatch, SimSide, simulate, stateAt } from './mock-sim';
import {
  ProviderFixture,
  ProviderLiveState,
  ProviderPlayer,
  ProviderSeries,
  ProviderSquad,
  ProviderTeam,
  shortPlayerName,
  SportsProvider,
} from './sports-provider';

/**
 * Demo-mode provider. Generates a believable, fully fictional fixture list around "today":
 * eight franchises and three T20 slots a day, plus an hourly 20-minute "Blitz" T10 so a whole
 * match can be watched live. Everything comes from seeded PRNGs, and each match is simulated
 * ball by ball (see mock-sim.ts) with deliveries released by the clock, so statuses, scores and
 * player stats move UPCOMING → LIVE → COMPLETED identically on every sync.
 */

const TEAMS: (ProviderTeam & { ground: string; city: string })[] = [
  { externalId: 'mock-mum', name: 'Mumbai Mavericks', shortName: 'MUM', color: '#1E88E5', logoUrl: null, ground: 'Marine Drive Oval', city: 'Mumbai' },
  { externalId: 'mock-che', name: 'Chennai Chargers', shortName: 'CHE', color: '#FBC02D', logoUrl: null, ground: 'Bay of Bengal Park', city: 'Chennai' },
  { externalId: 'mock-blr', name: 'Bengaluru Blazers', shortName: 'BLR', color: '#E53935', logoUrl: null, ground: 'Garden City Arena', city: 'Bengaluru' },
  { externalId: 'mock-kol', name: 'Kolkata Tigers', shortName: 'KOL', color: '#7E57C2', logoUrl: null, ground: 'Hooghly Riverside Ground', city: 'Kolkata' },
  { externalId: 'mock-del', name: 'Delhi Thunder', shortName: 'DEL', color: '#EF6C00', logoUrl: null, ground: 'Yamuna Cricket Park', city: 'Delhi' },
  { externalId: 'mock-hyd', name: 'Hyderabad Hawks', shortName: 'HYD', color: '#FF7043', logoUrl: null, ground: 'Deccan Plateau Stadium', city: 'Hyderabad' },
  { externalId: 'mock-jai', name: 'Jaipur Jaguars', shortName: 'JAI', color: '#EC407A', logoUrl: null, ground: 'Pink City Oval', city: 'Jaipur' },
  { externalId: 'mock-lko', name: 'Lucknow Lions', shortName: 'LKO', color: '#00ACC1', logoUrl: null, ground: 'Gomti Nagar Ground', city: 'Lucknow' },
];

const SERIES: ProviderSeries[] = [
  { externalId: 'mock-dpl-2026', name: 'Dream Premier League 2026', shortName: 'DPL', format: 'T20' },
  { externalId: 'mock-btc-2026', name: 'Bharat T20 Challenge', shortName: 'BTC', format: 'T20' },
];
const BLITZ_SERIES: ProviderSeries = { externalId: 'mock-blitz', name: 'Blitz T10 Showdown', shortName: 'BLZ', format: 'T10' };

/** UTC start times (hour, minute) — 10:00, 15:30 and 19:30 IST. */
const SLOTS: [number, number][] = [
  [4, 30],
  [10, 0],
  [14, 0],
];

interface FormatTiming {
  overs: number;
  /** Time between deliveries; the whole simulated match fits inside the scheduled window. */
  deliveryMs: number;
  lineupsBeforeMs: number;
}
const TIMING: Record<'T20' | 'T10', FormatTiming> = {
  T20: { overs: 20, deliveryMs: 45_000, lineupsBeforeMs: 45 * 60_000 },
  T10: { overs: 10, deliveryMs: 8_000, lineupsBeforeMs: 10 * 60_000 },
};
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Blitz matches are only listed from 3h ago to 4h ahead, so they don't flood the fixture list. */
const BLITZ_BACK_MS = 3 * HOUR_MS;
const BLITZ_AHEAD_MS = 4 * HOUR_MS;
const ABANDON_RATE = 0.04;

const FIRST = ['Aarav', 'Vihaan', 'Arjun', 'Kabir', 'Rohan', 'Ishaan', 'Aditya', 'Dev', 'Reyansh', 'Krish', 'Shaurya', 'Atharv', 'Yash', 'Rudra', 'Parth', 'Nikhil', 'Siddharth', 'Varun', 'Karan', 'Manav', 'Om', 'Tanay', 'Harsh', 'Ritvik', 'Ayaan', 'Laksh', 'Pranav', 'Samar', 'Dhruv', 'Neel', 'Aniket', 'Tejas', 'Kunal', 'Abhay', 'Rehan', 'Zoravar', 'Jai', 'Eshan', 'Vedant', 'Ansh'];
const LAST = ['Sharma', 'Iyer', 'Reddy', 'Patil', 'Nair', 'Chauhan', 'Bhatia', 'Menon', 'Kulkarni', 'Rathore', 'Saxena', 'Pillai', 'Joshi', 'Gill', 'Bose', 'Malhotra', 'Desai', 'Rana', 'Kapoor', 'Thakur', 'Shetty', 'Pandey', 'Mishra', 'Sandhu', 'Arora', 'Bhatt', 'Dutta', 'Yadav', 'Rawat', 'Chopra', 'Naidu', 'Kohli', 'Jadeja', 'Sinha', 'Mehta', 'Verma', 'Ghosh', 'Hegde', 'Rao', 'Tiwari'];
const ROLE_PLAN: PlayerRole[] = ['WK', 'WK', 'BAT', 'BAT', 'BAT', 'BAT', 'BAT', 'BAT', 'AR', 'AR', 'AR', 'AR', 'BOWL', 'BOWL', 'BOWL', 'BOWL', 'BOWL', 'BOWL'];
/** Playing XI shape picked from the 18-man squad when lineups are out. */
const XI_SHAPE: Record<PlayerRole, number> = { WK: 1, BAT: 4, AR: 2, BOWL: 4 };

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG. */
function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, min: number, max: number) => Math.round(min + r() * (max - min));
const toHalf = (n: number) => Math.round(n * 2) / 2;

interface SquadMember {
  base: Omit<ProviderPlayer, 'isPlaying' | 'credits'>;
  baseCredits: number;
}

function buildSquad(teamIndex: number): SquadMember[] {
  const team = TEAMS[teamIndex]!;
  return ROLE_PLAN.map((role, i) => {
    const k = teamIndex * ROLE_PLAN.length + i;
    const name = `${FIRST[(k * 7) % FIRST.length]} ${LAST[(k * 13 + Math.floor(k / LAST.length)) % LAST.length]}`;
    const r = rng(`player:${team.externalId}:${i}`);
    const quality = r();
    const matches = between(r, 12, 140);
    const runs = role === 'BOWL' ? between(r, 20, 450) : role === 'AR' ? between(r, 400, 2200) : between(r, 700, 4800);
    const wickets = role === 'BOWL' ? between(r, 25, 170) : role === 'AR' ? between(r, 15, 110) : between(r, 0, 4);
    const stats: PlayerStatsDto = {
      matches,
      runs,
      wickets,
      battingAverage: role === 'BOWL' ? null : Math.round((runs / Math.max(1, matches * 0.8)) * 10) / 10,
      strikeRate: role === 'BOWL' ? null : between(r, 115, 175),
      economy: role === 'BAT' || role === 'WK' ? null : Math.round((6.4 + r() * 3) * 100) / 100,
      recentPoints: Array.from({ length: 5 }, () => between(r, 0, Math.round(40 + quality * 90))),
    };
    return {
      baseCredits: toHalf(6.5 + quality * 4),
      base: {
        externalId: `${team.externalId}-p${String(i + 1).padStart(2, '0')}`,
        name,
        shortName: shortPlayerName(name),
        role,
        imageUrl: null,
        battingStyle: r() < 0.72 ? 'Right-hand bat' : 'Left-hand bat',
        bowlingStyle: role === 'BAT' || role === 'WK' ? null : r() < 0.55 ? 'Right-arm fast-medium' : r() < 0.5 ? 'Right-arm off-break' : 'Slow left-arm orthodox',
        country: 'India',
        stats,
      },
    };
  });
}

const SQUADS = TEAMS.map((_, i) => buildSquad(i));

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Round-robin via the circle method: team 0 stays fixed, the rest rotate each round,
 * so every round of four matches uses all eight teams exactly once.
 */
function pairing(idx: number): [number, number] {
  const n = TEAMS.length;
  const perRound = n / 2;
  const round = mod(Math.floor(idx / perRound), n - 1);
  const pos = mod(idx, perRound);
  const rest = Array.from({ length: n - 1 }, (_, i) => 1 + mod(i + round, n - 1));
  const circle = [0, ...rest];
  const a = circle[pos]!;
  const b = circle[n - 1 - pos]!;
  return round % 2 === 0 ? [a, b] : [b, a];
}


interface FixtureDef {
  externalId: string;
  homeIdx: number;
  awayIdx: number;
  series: ProviderSeries;
  format: 'T20' | 'T10';
  startTime: Date;
}

function dailyFixture(dayIndex: number, slot: number): FixtureDef {
  const [homeIdx, awayIdx] = pairing(dayIndex * SLOTS.length + slot);
  const [h, m] = SLOTS[slot]!;
  return {
    externalId: `mock-${dayIndex}-${slot}`,
    homeIdx,
    awayIdx,
    series: SERIES[slot === 0 ? 1 : 0]!,
    format: 'T20',
    startTime: new Date(dayIndex * DAY_MS + (h * 60 + m) * 60_000),
  };
}

/** Hourly 20-minute T10 on the hour (UTC), offset in the round-robin so pairings differ from the T20s. */
function blitzFixture(hourIndex: number): FixtureDef {
  const [homeIdx, awayIdx] = pairing(hourIndex * 5 + 3);
  return { externalId: `mock-blitz-${hourIndex}`, homeIdx, awayIdx, series: BLITZ_SERIES, format: 'T10', startTime: new Date(hourIndex * HOUR_MS) };
}

function fixtureById(externalId: string): FixtureDef | null {
  const blitz = /^mock-blitz-(-?\d+)$/.exec(externalId);
  if (blitz) return blitzFixture(Number(blitz[1]));
  const daily = /^mock-(-?\d+)-(\d)$/.exec(externalId);
  return daily ? dailyFixture(Number(daily[1]), Number(daily[2])) : null;
}

/** Playing XI picked from the 18-man squad. Separate seed from prices so prices don't move when lineups land. */
function pickXI(fixtureId: string, teamIdx: number): SquadMember[] {
  const r = rng(`xi:${fixtureId}:${teamIdx}`);
  const squad = SQUADS[teamIdx]!;
  const chosen: SquadMember[] = [];
  for (const role of Object.keys(XI_SHAPE) as PlayerRole[]) {
    const pool = squad.filter((m) => m.base.role === role).sort(() => r() - 0.5);
    chosen.push(...pool.slice(0, XI_SHAPE[role]));
  }
  return chosen;
}

const quality = (m: SquadMember) => (m.baseCredits - 6.5) / 4;

/** Batting order: two best batters open, then keeper, remaining batters, all-rounders, bowlers. */
function simSide(def: FixtureDef, teamIdx: number): SimSide {
  const xi = pickXI(def.externalId, teamIdx);
  const byQ = (a: SquadMember, b: SquadMember) => b.baseCredits - a.baseCredits;
  const bats = xi.filter((m) => m.base.role === 'BAT').sort(byQ);
  const order = [
    ...bats.slice(0, 2),
    ...xi.filter((m) => m.base.role === 'WK'),
    ...bats.slice(2),
    ...xi.filter((m) => m.base.role === 'AR').sort(byQ),
    ...xi.filter((m) => m.base.role === 'BOWL').sort(byQ),
  ];
  const team = TEAMS[teamIdx]!;
  return {
    teamExternalId: team.externalId,
    shortName: team.shortName,
    name: team.name,
    xi: order.map((m) => ({ externalId: m.base.externalId, role: m.base.role, quality: quality(m) })),
  };
}

const sims = new Map<string, SimMatch>();

function simFor(def: FixtureDef): SimMatch {
  const cached = sims.get(def.externalId);
  if (cached) return cached;
  const r = rng(`toss:${def.externalId}`);
  const home = simSide(def, def.homeIdx);
  const away = simSide(def, def.awayIdx);
  const tossWinner = r() < 0.5 ? home : away;
  const other = tossWinner === home ? away : home;
  const bat = r() < 0.4;
  const sim = simulate(
    def.externalId,
    TIMING[def.format].overs,
    bat ? tossWinner : other,
    bat ? other : tossWinner,
    `${tossWinner.shortName} won the toss and chose to ${bat ? 'bat' : 'bowl'}`,
  );
  sims.set(def.externalId, sim);
  return sim;
}

const isAbandoned = (def: FixtureDef) => rng(`abandon:${def.externalId}`)() < ABANDON_RATE;

/** Single source of truth for a fixture's status at time `now` (used by fixtures and live). */
function statusAt(def: FixtureDef, now: number): { status: MatchStatus; note: string | null; delivered: number } {
  const start = def.startTime.getTime();
  const timing = TIMING[def.format];
  if (now < start) return { status: 'UPCOMING', note: start - now <= timing.lineupsBeforeMs ? 'Lineups out' : null, delivered: 0 };
  if (isAbandoned(def)) return { status: 'ABANDONED', note: 'Match abandoned due to rain', delivered: 0 };
  const sim = simFor(def);
  const delivered = Math.floor((now - start) / timing.deliveryMs);
  if (delivered >= sim.deliveries.length) return { status: 'COMPLETED', note: sim.resultNote, delivered: sim.deliveries.length };
  return { status: 'LIVE', note: stateAt(sim, delivered).note, delivered };
}

export class MockProvider implements SportsProvider {
  readonly name = 'mock';

  constructor(private readonly clock: () => number = Date.now) {}

  async fetchFixtures(from: Date, to: Date): Promise<ProviderFixture[]> {
    const now = this.clock();
    const defs: FixtureDef[] = [];
    for (let day = Math.floor(from.getTime() / DAY_MS); day <= Math.floor(to.getTime() / DAY_MS); day++) {
      for (let slot = 0; slot < SLOTS.length; slot++) defs.push(dailyFixture(day, slot));
    }
    const blitzFrom = Math.max(from.getTime(), now - BLITZ_BACK_MS);
    const blitzTo = Math.min(to.getTime(), now + BLITZ_AHEAD_MS);
    for (let h = Math.ceil(blitzFrom / HOUR_MS); h * HOUR_MS <= blitzTo; h++) defs.push(blitzFixture(h));

    return defs
      .filter((d) => d.startTime >= from && d.startTime <= to)
      .map((d) => {
        const home = TEAMS[d.homeIdx]!;
        const away = TEAMS[d.awayIdx]!;
        const { status, note } = statusAt(d, now);
        return {
          externalId: d.externalId,
          sportKey: 'cricket',
          series: d.series,
          home: strip(home),
          away: strip(away),
          venue: `${home.ground}, ${home.city}`,
          city: home.city,
          format: d.format,
          startTime: d.startTime,
          status,
          statusNote: note,
          lineupsAnnounced: status !== 'UPCOMING' || d.startTime.getTime() - now <= TIMING[d.format].lineupsBeforeMs,
        };
      });
  }

  async fetchSquads(fixtureExternalId: string): Promise<ProviderSquad[]> {
    const def = fixtureById(fixtureExternalId);
    if (!def) return [];
    const lineupsOut = def.startTime.getTime() - this.clock() <= TIMING[def.format].lineupsBeforeMs;
    return [def.homeIdx, def.awayIdx].map((teamIdx) => {
      const prices = rng(`price:${fixtureExternalId}:${teamIdx}`);
      const xi = lineupsOut ? new Set(pickXI(fixtureExternalId, teamIdx).map((m) => m.base.externalId)) : null;
      return {
        team: strip(TEAMS[teamIdx]!),
        players: SQUADS[teamIdx]!.map((m) => ({
          ...m.base,
          // Small per-match price movement around the player's base value.
          credits: Math.min(11, Math.max(6, m.baseCredits + toHalf((prices() - 0.5) * 1.2))),
          isPlaying: xi ? xi.has(m.base.externalId) : null,
        })),
      };
    });
  }

  async fetchLive(fixtureExternalId: string): Promise<ProviderLiveState | null> {
    const def = fixtureById(fixtureExternalId);
    if (!def) return null;
    const { status, note, delivered } = statusAt(def, this.clock());
    if (status === 'UPCOMING') return null;
    if (status === 'ABANDONED') return { status, statusNote: note, innings: [], recentBalls: [], players: {}, final: true };
    const state = stateAt(simFor(def), delivered);
    return {
      status,
      statusNote: note,
      innings: state.innings,
      recentBalls: state.recentBalls,
      players: state.players,
      final: status === 'COMPLETED',
    };
  }
}

const strip = ({ externalId, name, shortName, logoUrl, color }: ProviderTeam): ProviderTeam => ({ externalId, name, shortName, logoUrl, color });
