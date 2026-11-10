/**
 * Shot tracer styles, unlocked by achievements: completing particular challenges, setting
 * personal records, and reaching points levels. Unlocks are derived from the player's data,
 * so they can never get out of sync (and deleting data can re-lock a style).
 */
import { completedChallenges, levelForPoints, totalPoints } from './challenges';
import { hasBrokenRecord } from './records';
import type { ChallengeAttempt, Round, Shot } from './types';

export interface TracerStyle {
  id: string;
  name: string;
  /** How to unlock it, shown while locked. */
  hint: string;
  /** One colour, or several for a gradient along the flight. */
  colors: string[];
  width: number;
  /** A soft wide halo under the line. */
  glow?: string;
  /** SVG dash pattern. */
  dash?: number[];
  /** Comet: the line fades in from the tee, brightest at the ball. */
  comet?: boolean;
  /** A second thin line drawn on top. */
  core?: string;
  landing: 'dot' | 'ring' | 'star' | 'burst';
}

export interface UnlockContext {
  completedIds: Set<string>;
  completedCount: number;
  level: number;
  points: number;
  brokeRecord: boolean;
  shotCount: number;
  roundsFinished: number;
}

interface StyleDef extends TracerStyle {
  unlocked: (c: UnlockContext) => boolean;
}

const STYLES: StyleDef[] = [
  {
    id: 'classic',
    name: 'Classic Red',
    hint: 'Unlocked from the start',
    colors: ['#FF3B30'],
    width: 3,
    landing: 'dot',
    unlocked: () => true,
  },
  {
    id: 'ice',
    name: 'Ice Blue',
    hint: 'Complete any challenge',
    colors: ['#7FDBFF'],
    width: 3,
    glow: 'rgba(127,219,255,0.35)',
    landing: 'ring',
    unlocked: (c) => c.completedCount >= 1,
  },
  {
    id: 'record',
    name: 'Record Breaker',
    hint: 'Beat one of your personal records',
    colors: ['#FF2D95'],
    width: 3.5,
    glow: 'rgba(255,45,149,0.3)',
    landing: 'star',
    unlocked: (c) => c.brokeRecord,
  },
  {
    id: 'birdie-gold',
    name: 'Birdie Gold',
    hint: 'Complete Birdie Hunter',
    colors: ['#FFD54F', '#FFB300'],
    width: 3.5,
    glow: 'rgba(255,213,79,0.35)',
    landing: 'star',
    unlocked: (c) => c.completedIds.has('birdie-hunter'),
  },
  {
    id: 'flame',
    name: 'Flame',
    hint: 'Complete Hot Streak',
    colors: ['#FFEB3B', '#FF9800', '#F4511E'],
    width: 4,
    glow: 'rgba(255,87,34,0.4)',
    core: '#FFF8E1',
    landing: 'burst',
    unlocked: (c) => c.completedIds.has('par-streak'),
  },
  {
    id: 'comet',
    name: 'Comet',
    hint: 'Complete Long Ball (beat your longest carry)',
    colors: ['#FFFFFF'],
    width: 4,
    glow: 'rgba(255,255,255,0.35)',
    comet: true,
    landing: 'burst',
    unlocked: (c) => c.completedIds.has('distance-pr'),
  },
  {
    id: 'neon-dash',
    name: 'Neon Dash',
    hint: 'Complete Tight Group',
    colors: ['#00E5FF'],
    width: 3,
    glow: 'rgba(0,229,255,0.4)',
    dash: [10, 7],
    landing: 'ring',
    unlocked: (c) => c.completedIds.has('tight-group'),
  },
  {
    id: 'lightning',
    name: 'Lightning',
    hint: 'Complete Speed Session',
    colors: ['#B388FF', '#7C4DFF'],
    width: 3,
    glow: 'rgba(124,77,255,0.45)',
    core: '#FFFFFF',
    landing: 'burst',
    unlocked: (c) => c.completedIds.has('ball-speed-pr'),
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    hint: 'Complete One-Club Wonder',
    colors: ['#FF1744', '#FF9100', '#FFEA00', '#00E676', '#2979FF', '#D500F9'],
    width: 4,
    landing: 'star',
    unlocked: (c) => c.completedIds.has('one-club-par') || c.completedIds.has('one-club-birdie'),
  },
  {
    id: 'royal',
    name: 'Royal Purple',
    hint: 'Reach level 3 (300 challenge points)',
    colors: ['#E040FB', '#7B1FA2'],
    width: 4,
    glow: 'rgba(171,71,188,0.35)',
    landing: 'ring',
    unlocked: (c) => c.level >= 3,
  },
  {
    id: 'emerald',
    name: 'Emerald',
    hint: 'Finish 5 rounds',
    colors: ['#69F0AE', '#00C853'],
    width: 3.5,
    glow: 'rgba(0,200,83,0.3)',
    landing: 'dot',
    unlocked: (c) => c.roundsFinished >= 5,
  },
  {
    id: 'champion',
    name: 'Champion Platinum',
    hint: 'Reach level 5 and complete 10 challenges',
    colors: ['#FFFFFF', '#B0BEC5', '#FFFFFF'],
    width: 5,
    glow: 'rgba(255,255,255,0.5)',
    core: '#FFD54F',
    comet: true,
    landing: 'burst',
    unlocked: (c) => c.level >= 5 && c.completedCount >= 10,
  },
];

export const TRACER_STYLES: TracerStyle[] = STYLES.map(({ unlocked: _u, ...style }) => style);
export const DEFAULT_TRACER = 'classic';

export const tracerById = (id: string | undefined): TracerStyle =>
  TRACER_STYLES.find((s) => s.id === id) ?? TRACER_STYLES[0];

export function unlockContext(rounds: Round[], attempts: ChallengeAttempt[], shots: Shot[]): UnlockContext {
  const { ids, count } = completedChallenges(rounds, attempts, shots);
  const points = totalPoints(rounds, attempts, shots);
  return {
    completedIds: ids,
    completedCount: count,
    points,
    level: levelForPoints(points),
    brokeRecord: hasBrokenRecord(shots),
    shotCount: shots.length,
    roundsFinished: rounds.filter((r) => r.finishedAt).length,
  };
}

export function unlockedTracerIds(ctx: UnlockContext): string[] {
  return STYLES.filter((s) => s.unlocked(ctx)).map((s) => s.id);
}
