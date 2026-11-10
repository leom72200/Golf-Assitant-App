/**
 * Challenges add an optional goal on top of a normal round. Each one is evaluated purely from
 * the scorecard, so progress updates live as holes are entered.
 */
import { greenInRegulation, isPlayed, summarizeRound, toPar, upAndDown } from './scoring';
import type { HoleScore, Round } from './types';

export type ChallengeStatus = 'in_progress' | 'completed' | 'failed';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface ChallengeProgress {
  status: ChallengeStatus;
  /** 0..1 */
  progress: number;
  detail: string;
}

export interface ChallengeContext {
  /** The player's previously finished rounds, for "beat your average" style goals. */
  pastRounds: Round[];
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  emoji: string;
  difficulty: Difficulty;
  points: number;
  evaluate: (round: Round, ctx: ChallengeContext) => ChallengeProgress;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** "Do X at least N times" goals, failing early once N is out of reach. */
function countGoal(
  scores: HoleScore[],
  target: number,
  counts: (h: HoleScore) => boolean,
  eligible: (h: HoleScore) => boolean,
  noun: string,
): ChallengeProgress {
  const got = scores.filter((h) => isPlayed(h) && counts(h)).length;
  const remaining = scores.filter((h) => !isPlayed(h) && eligible(h)).length;
  if (got >= target) return { status: 'completed', progress: 1, detail: `${got} ${noun}` };
  if (got + remaining < target) {
    return { status: 'failed', progress: clamp01(got / target), detail: `${got}/${target} ${noun} — out of holes` };
  }
  return { status: 'in_progress', progress: clamp01(got / target), detail: `${got}/${target} ${noun}` };
}

/** "Never do X" goals: fail on the first occurrence, complete when the round is done. */
function avoidGoal(scores: HoleScore[], bad: (h: HoleScore) => boolean, what: string): ChallengeProgress {
  const played = scores.filter(isPlayed);
  const offender = played.find(bad);
  if (offender) return { status: 'failed', progress: 0, detail: `${what} on hole ${offender.hole}` };
  const done = played.length === scores.length && scores.length > 0;
  return {
    status: done ? 'completed' : 'in_progress',
    progress: scores.length === 0 ? 0 : played.length / scores.length,
    detail: done ? `Clean through ${played.length} holes` : `${played.length}/${scores.length} holes clean`,
  };
}

/** Longest run of consecutive played holes satisfying `pred`. */
function longestStreak(scores: HoleScore[], pred: (h: HoleScore & { strokes: number }) => boolean): number {
  let best = 0;
  let cur = 0;
  for (const h of [...scores].sort((a, b) => a.hole - b.hole)) {
    if (isPlayed(h) && pred(h)) {
      cur += 1;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'fairway-finder',
    title: 'Fairway Finder',
    description: 'Hit at least 7 fairways off the tee on par 4s and 5s.',
    emoji: '🎯',
    difficulty: 'medium',
    points: 30,
    evaluate: (r) => {
      const target = Math.min(7, r.scores.filter((h) => h.par >= 4).length);
      return countGoal(r.scores, target, (h) => h.par >= 4 && h.fairwayHit === true, (h) => h.par >= 4, 'fairways');
    },
  },
  {
    id: 'no-three-putts',
    title: 'Lag Master',
    description: 'Finish the round without a single 3-putt.',
    emoji: '⛳',
    difficulty: 'medium',
    points: 40,
    evaluate: (r) => avoidGoal(r.scores, (h) => (h.putts ?? 0) >= 3, '3-putt'),
  },
  {
    id: 'par-streak',
    title: 'Hot Streak',
    description: 'Make par or better on 3 holes in a row.',
    emoji: '🔥',
    difficulty: 'medium',
    points: 30,
    evaluate: (r) => {
      const streak = longestStreak(r.scores, (h) => toPar(h) <= 0);
      if (streak >= 3) return { status: 'completed', progress: 1, detail: `${streak} in a row` };
      const done = summarizeRound(r).finished;
      return {
        status: done ? 'failed' : 'in_progress',
        progress: streak / 3,
        detail: `Best streak: ${streak}`,
      };
    },
  },
  {
    id: 'birdie-hunter',
    title: 'Birdie Hunter',
    description: 'Make at least one birdie (or better).',
    emoji: '🐦',
    difficulty: 'hard',
    points: 50,
    evaluate: (r) => countGoal(r.scores, 1, (h) => isPlayed(h) && toPar(h) <= -1, () => true, 'birdies'),
  },
  {
    id: 'scrambler',
    title: 'Scrambler',
    description: 'Miss the green but still save par 3 times (enter putts to track).',
    emoji: '🧗',
    difficulty: 'hard',
    points: 45,
    evaluate: (r) => countGoal(r.scores, 3, upAndDown, () => true, 'saves'),
  },
  {
    id: 'sandy',
    title: 'Sandy',
    description: 'Make par or better on a hole where you played out of a bunker.',
    emoji: '🏖️',
    difficulty: 'hard',
    points: 40,
    evaluate: (r) => countGoal(r.scores, 1, (h) => isPlayed(h) && !!h.sandShot && toPar(h) <= 0, () => true, 'sandies'),
  },
  {
    id: 'no-doubles',
    title: 'Damage Control',
    description: 'No double bogeys or worse all round.',
    emoji: '🛡️',
    difficulty: 'medium',
    points: 35,
    evaluate: (r) => avoidGoal(r.scores, (h) => isPlayed(h) && toPar(h) >= 2, 'Double bogey'),
  },
  {
    id: 'clean-card',
    title: 'Clean Card',
    description: 'No penalty strokes — stay out of the water and in bounds.',
    emoji: '💧',
    difficulty: 'easy',
    points: 20,
    evaluate: (r) => avoidGoal(r.scores, (h) => (h.penalties ?? 0) > 0, 'Penalty'),
  },
  {
    id: 'putt-master',
    title: 'Putt Master',
    description: 'Average fewer than 1.75 putts per hole (31 or fewer over 18).',
    emoji: '🏌️',
    difficulty: 'hard',
    points: 45,
    evaluate: (r) => {
      const limit = Math.floor(r.scores.length * 1.75 - 0.01);
      const s = summarizeRound(r);
      if (s.putts > limit) return { status: 'failed', progress: 0, detail: `${s.putts} putts (limit ${limit})` };
      if (s.finished) return { status: 'completed', progress: 1, detail: `${s.putts} putts` };
      return {
        status: 'in_progress',
        progress: s.holesPlayed / Math.max(1, s.totalHoles),
        detail: `${s.putts}/${limit} putts used`,
      };
    },
  },
  {
    id: 'par-3-hero',
    title: 'Par 3 Hero',
    description: 'Par or better on every par 3.',
    emoji: '🦸',
    difficulty: 'hard',
    points: 40,
    evaluate: (r) => {
      const par3s = r.scores.filter((h) => h.par === 3);
      if (par3s.length === 0) return { status: 'failed', progress: 0, detail: 'No par 3s on this card' };
      return avoidGoal(par3s, (h) => isPlayed(h) && toPar(h) > 0, 'Over par');
    },
  },
  {
    id: 'gir-five',
    title: 'Iron Sharp',
    description: 'Hit 5 greens in regulation (enter putts to track).',
    emoji: '🟢',
    difficulty: 'medium',
    points: 35,
    evaluate: (r) => countGoal(r.scores, 5, (h) => greenInRegulation(h) === true, () => true, 'greens'),
  },
  {
    id: 'beat-average',
    title: 'Personal Best Pace',
    description: 'Finish with a better score-to-par than your average round.',
    emoji: '📈',
    difficulty: 'medium',
    points: 40,
    evaluate: (r, ctx) => {
      const past = ctx.pastRounds
        .filter((p) => p.id !== r.id)
        .map(summarizeRound)
        .filter((s) => s.finished && s.totalHoles === r.scores.length);
      if (past.length === 0) {
        return { status: 'in_progress', progress: 0, detail: 'Finish a round first to set your average' };
      }
      const avg = past.reduce((a, s) => a + s.toPar, 0) / past.length;
      const s = summarizeRound(r);
      const avgStr = (Math.round(avg * 10) / 10).toString();
      if (!s.finished) {
        return {
          status: 'in_progress',
          progress: s.holesPlayed / Math.max(1, s.totalHoles),
          detail: `Average ${avgStr} — currently ${s.toPar >= 0 ? '+' : ''}${s.toPar}`,
        };
      }
      return s.toPar < avg
        ? { status: 'completed', progress: 1, detail: `Beat your ${avgStr} average` }
        : { status: 'failed', progress: 1, detail: `Average is ${avgStr}` };
    },
  },
];

export const challengeById = (id: string) => CHALLENGES.find((c) => c.id === id);

/** Pick `count` distinct challenges using a seeded shuffle, so a "daily" set is stable all day. */
export function dailyChallenges(date: Date, count = 3): Challenge[] {
  let seed = date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();
  const rand = () => {
    // Mulberry32
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...CHALLENGES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Total points from every completed challenge across finished rounds. */
export function totalPoints(rounds: Round[]): number {
  let pts = 0;
  for (const r of rounds) {
    for (const id of r.challengeIds) {
      const c = challengeById(id);
      // Only rounds played before this one count as "history" for this round.
      const pastRounds = rounds.filter((p) => p.startedAt < r.startedAt);
      if (c && c.evaluate(r, { pastRounds }).status === 'completed') pts += c.points;
    }
  }
  return pts;
}
