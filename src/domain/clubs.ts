import type { Club, Shot } from './types';

/** A typical 14-club set the player can edit later. */
export const DEFAULT_BAG: Club[] = [
  { id: 'dr', name: 'Driver', category: 'wood', loft: 10.5, inBag: true, order: 0 },
  { id: '3w', name: '3W', category: 'wood', loft: 15, inBag: true, order: 1 },
  { id: '5w', name: '5W', category: 'wood', loft: 18, inBag: false, order: 2 },
  { id: '4h', name: '4H', category: 'hybrid', loft: 22, inBag: true, order: 3 },
  { id: '4i', name: '4i', category: 'iron', loft: 21, inBag: false, order: 4 },
  { id: '5i', name: '5i', category: 'iron', loft: 24, inBag: true, order: 5 },
  { id: '6i', name: '6i', category: 'iron', loft: 27, inBag: true, order: 6 },
  { id: '7i', name: '7i', category: 'iron', loft: 31, inBag: true, order: 7 },
  { id: '8i', name: '8i', category: 'iron', loft: 35, inBag: true, order: 8 },
  { id: '9i', name: '9i', category: 'iron', loft: 39, inBag: true, order: 9 },
  { id: 'pw', name: 'PW', category: 'wedge', loft: 44, inBag: true, order: 10 },
  { id: 'gw', name: 'GW', category: 'wedge', loft: 50, inBag: true, order: 11 },
  { id: 'sw', name: 'SW', category: 'wedge', loft: 56, inBag: true, order: 12 },
  { id: 'lw', name: 'LW', category: 'wedge', loft: 60, inBag: true, order: 13 },
  { id: 'pt', name: 'Putter', category: 'putter', inBag: true, order: 14 },
];

export interface ClubStats {
  shotCount: number;
  /** Shots used for the stats (mishits excluded). */
  usedCount: number;
  /** "Stock" carry: the mean after trimming the shortest and longest 10% of good shots. */
  stockCarry?: number;
  avgTotal?: number;
  /** Distance range that covers the middle ~80% of good shots. */
  carryRange?: [number, number];
  /** Standard deviation of carry: lower means more consistent. */
  carrySpread?: number;
  avgBallSpeed?: number;
  avgClubSpeed?: number;
  /** Ball speed / club speed. ~1.5 is excellent with a driver, ~1.33 with a 7 iron. */
  smashFactor?: number;
  avgLaunch?: number;
  avgSpin?: number;
  /** Mean offline distance: negative = tends left, positive = tends right. */
  avgOffline?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number | undefined {
  const m = mean(values);
  if (m === undefined || values.length < 2) return undefined;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Linear-interpolated percentile (p in 0..1) of an unsorted list. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Mean after dropping `fraction` of values from each end. */
export function trimmedMean(values: number[], fraction = 0.1): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const drop = Math.floor(sorted.length * fraction);
  return mean(sorted.slice(drop, sorted.length - drop));
}

function pick(shots: Shot[], key: keyof Shot): number[] {
  return shots
    .map((s) => s[key])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

export function clubStats(shots: Shot[]): ClubStats {
  const good = shots.filter((s) => !s.mishit);
  const carries = pick(good, 'carryYards');
  const p10 = percentile(carries, 0.1);
  const p90 = percentile(carries, 0.9);

  // Smash factor only makes sense from shots that have both speeds.
  const paired = good.filter(
    (s) => typeof s.ballSpeedMph === 'number' && typeof s.clubSpeedMph === 'number' && s.clubSpeedMph > 0,
  );
  const smash = mean(paired.map((s) => s.ballSpeedMph! / s.clubSpeedMph!));

  const opt = (v: number | undefined) => (v === undefined ? undefined : round1(v));
  return {
    shotCount: shots.length,
    usedCount: good.length,
    stockCarry: opt(trimmedMean(carries)),
    avgTotal: opt(mean(pick(good, 'totalYards'))),
    carryRange: p10 !== undefined && p90 !== undefined ? [Math.round(p10), Math.round(p90)] : undefined,
    carrySpread: opt(stdDev(carries)),
    avgBallSpeed: opt(mean(pick(good, 'ballSpeedMph'))),
    avgClubSpeed: opt(mean(pick(good, 'clubSpeedMph'))),
    smashFactor: smash === undefined ? undefined : Math.round(smash * 100) / 100,
    avgLaunch: opt(mean(pick(good, 'launchAngleDeg'))),
    avgSpin: (() => {
      const m = mean(pick(good, 'spinRpm'));
      return m === undefined ? undefined : Math.round(m);
    })(),
    avgOffline: opt(mean(pick(good, 'offlineYards'))),
  };
}

/**
 * Suggest the club whose stock carry is closest to (but preferably not short of) the target.
 * Clubs without data are ignored.
 */
export function suggestClub(
  targetYards: number,
  clubs: Club[],
  statsByClub: Record<string, ClubStats>,
): Club | undefined {
  const candidates = clubs
    .filter((c) => c.inBag && c.category !== 'putter')
    .map((c) => ({ club: c, carry: statsByClub[c.id]?.stockCarry }))
    .filter((c): c is { club: Club; carry: number } => c.carry !== undefined);
  if (candidates.length === 0) return undefined;

  // Prefer the shortest club that still reaches; otherwise the longest one available.
  const reaching = candidates.filter((c) => c.carry >= targetYards).sort((a, b) => a.carry - b.carry);
  if (reaching.length > 0) return reaching[0].club;
  return candidates.sort((a, b) => b.carry - a.carry)[0].club;
}

/** Typical amateur carry (yards) for a club of the given loft, used until the player has data. */
export function typicalCarryForLoft(loft: number): number {
  const table: [number, number][] = [
    [10, 220], [15, 200], [18, 188], [22, 176], [24, 165], [27, 155],
    [31, 145], [35, 135], [39, 124], [44, 112], [50, 98], [56, 84], [60, 70],
  ];
  if (loft <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [l1, c1] = table[i];
    const [l0, c0] = table[i - 1];
    if (loft <= l1) return Math.round(c0 + ((c1 - c0) * (loft - l0)) / (l1 - l0));
  }
  return table[table.length - 1][1];
}
