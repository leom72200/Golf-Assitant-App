/**
 * Challenges add an optional goal on top of normal golf. There are two kinds:
 *
 *  - Round challenges are scored from the scorecard and update live as holes are entered.
 *    Some take a club of the player's choice ("make par using only your 7-iron").
 *  - Range challenges are scored from shots logged during a session with one chosen club
 *    ("out-carry your longest 7-iron"). The number to beat is snapshotted when the session
 *    starts, so later shots can't move the goalposts.
 */
import { clubStats } from './clubs';
import { typicalSmashForLoft } from './launch';
import { shotMetric } from './records';
import { greenInRegulation, isPlayed, longestStreak, summarizeRound, toPar, upAndDown } from './scoring';
import type { ChallengeAttempt, Club, HoleScore, Round, Shot } from './types';

export type ChallengeStatus = 'in_progress' | 'completed' | 'failed';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface ChallengeProgress {
  status: ChallengeStatus;
  /** 0..1 */
  progress: number;
  detail: string;
}

export interface RoundChallengeContext {
  /** The player's previously finished rounds, for "beat your average" style goals. */
  pastRounds: Round[];
}

interface ChallengeBase {
  id: string;
  /** May contain `{club}`, replaced by the chosen club's name. */
  title: string;
  /** May contain `{club}` and, for range challenges, `{target}`. */
  description: string;
  emoji: string;
  difficulty: Difficulty;
  points: number;
}

export interface RoundChallenge extends ChallengeBase {
  scope: 'round';
  /** The player picks a club when adding this challenge to a round. */
  needsClub?: boolean;
  evaluate: (round: Round, ctx: RoundChallengeContext) => ChallengeProgress;
}

export interface RangeChallenge extends ChallengeBase {
  scope: 'range';
  /** Why a session can't start yet (e.g. not enough history), or undefined if it can. */
  cannotStart?: (priorShots: Shot[], club: Club) => string | undefined;
  /** The number to beat, computed from the club's shots before the session. */
  baseline?: (priorShots: Shot[], club: Club) => number | undefined;
  /** Shots are this session's shots with the chosen club, oldest first. */
  evaluate: (sessionShots: Shot[], attempt: ChallengeAttempt) => ChallengeProgress;
  /** Formats the baseline for `{target}` in the description. */
  formatTarget?: (baseline: number) => string;
}

export type Challenge = RoundChallenge | RangeChallenge;

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

// ---------------------------------------------------------------------------------------------
// Round challenges
// ---------------------------------------------------------------------------------------------

export const ROUND_CHALLENGES: RoundChallenge[] = [
  {
    scope: 'round',
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
    scope: 'round',
    id: 'no-three-putts',
    title: 'Lag Master',
    description: 'Finish the round without a single 3-putt.',
    emoji: '⛳',
    difficulty: 'medium',
    points: 40,
    evaluate: (r) => avoidGoal(r.scores, (h) => (h.putts ?? 0) >= 3, '3-putt'),
  },
  {
    scope: 'round',
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
      return { status: done ? 'failed' : 'in_progress', progress: streak / 3, detail: `Best streak: ${streak}` };
    },
  },
  {
    scope: 'round',
    id: 'birdie-hunter',
    title: 'Birdie Hunter',
    description: 'Make at least one birdie (or better).',
    emoji: '🐦',
    difficulty: 'hard',
    points: 50,
    evaluate: (r) => countGoal(r.scores, 1, (h) => isPlayed(h) && toPar(h) <= -1, () => true, 'birdies'),
  },
  {
    scope: 'round',
    id: 'one-club-par',
    title: 'One-Club Wonder',
    description: 'Make par or better on a hole using only your {club} — tee shot to putt.',
    emoji: '🪄',
    difficulty: 'hard',
    points: 50,
    needsClub: true,
    evaluate: (r) =>
      countGoal(r.scores, 1, (h) => isPlayed(h) && !!h.singleClub && toPar(h) <= 0, () => true, 'one-club pars'),
  },
  {
    scope: 'round',
    id: 'one-club-birdie',
    title: 'One-Club Legend',
    description: 'Make a birdie on a hole using only your {club}. Good luck.',
    emoji: '🦄',
    difficulty: 'hard',
    points: 100,
    needsClub: true,
    evaluate: (r) =>
      countGoal(r.scores, 1, (h) => isPlayed(h) && !!h.singleClub && toPar(h) <= -1, () => true, 'one-club birdies'),
  },
  {
    scope: 'round',
    id: 'scrambler',
    title: 'Scrambler',
    description: 'Miss the green but still save par 3 times (enter putts to track).',
    emoji: '🧗',
    difficulty: 'hard',
    points: 45,
    evaluate: (r) => countGoal(r.scores, 3, upAndDown, () => true, 'saves'),
  },
  {
    scope: 'round',
    id: 'sandy',
    title: 'Sandy',
    description: 'Make par or better on a hole where you played out of a bunker.',
    emoji: '🏖️',
    difficulty: 'hard',
    points: 40,
    evaluate: (r) =>
      countGoal(r.scores, 1, (h) => isPlayed(h) && !!h.sandShot && toPar(h) <= 0, () => true, 'sandies'),
  },
  {
    scope: 'round',
    id: 'no-doubles',
    title: 'Damage Control',
    description: 'No double bogeys or worse all round.',
    emoji: '🛡️',
    difficulty: 'medium',
    points: 35,
    evaluate: (r) => avoidGoal(r.scores, (h) => isPlayed(h) && toPar(h) >= 2, 'Double bogey'),
  },
  {
    scope: 'round',
    id: 'clean-card',
    title: 'Clean Card',
    description: 'No penalty strokes — stay out of the water and in bounds.',
    emoji: '💧',
    difficulty: 'easy',
    points: 20,
    evaluate: (r) => avoidGoal(r.scores, (h) => (h.penalties ?? 0) > 0, 'Penalty'),
  },
  {
    scope: 'round',
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
    scope: 'round',
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
    scope: 'round',
    id: 'gir-five',
    title: 'Iron Sharp',
    description: 'Hit 5 greens in regulation (enter putts to track).',
    emoji: '🟢',
    difficulty: 'medium',
    points: 35,
    evaluate: (r) => countGoal(r.scores, 5, (h) => greenInRegulation(h) === true, () => true, 'greens'),
  },
  {
    scope: 'round',
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

// ---------------------------------------------------------------------------------------------
// Range challenges
// ---------------------------------------------------------------------------------------------

const good = (shots: Shot[]) => shots.filter((s) => !s.mishit);

/** Beat the best value of a metric. With no history, the first valid shot sets the record. */
function beatRecord(
  shots: Shot[],
  attempt: ChallengeAttempt,
  metric: 'carry' | 'ballSpeed',
  unit: string,
): ChallengeProgress {
  const values = good(shots)
    .map((s) => shotMetric(s, metric))
    .filter((v): v is number => v !== undefined);
  const best = values.length ? Math.max(...values) : undefined;
  const target = attempt.baseline;
  if (best === undefined) {
    return {
      status: 'in_progress',
      progress: 0,
      detail: target === undefined ? 'Log a shot to set your first record' : `Beat ${target.toFixed(0)} ${unit}`,
    };
  }
  if (target === undefined) return { status: 'completed', progress: 1, detail: `First record: ${best.toFixed(0)} ${unit}` };
  if (best > target) {
    return { status: 'completed', progress: 1, detail: `New record: ${best.toFixed(0)} ${unit} (was ${target.toFixed(0)})` };
  }
  return {
    status: 'in_progress',
    progress: clamp01(best / target),
    detail: `Best today ${best.toFixed(0)} ${unit} · record ${target.toFixed(0)} ${unit}`,
  };
}

const bestOf = (shots: Shot[], metric: 'carry' | 'ballSpeed') => {
  const v = good(shots)
    .map((s) => shotMetric(s, metric))
    .filter((x): x is number => x !== undefined);
  return v.length ? Math.max(...v) : undefined;
};

export const RANGE_CHALLENGES: RangeChallenge[] = [
  {
    scope: 'range',
    id: 'distance-pr',
    title: 'Long Ball',
    description: 'Out-carry your longest {club} shot ({target}).',
    emoji: '🚀',
    difficulty: 'medium',
    points: 40,
    baseline: (prior) => bestOf(prior, 'carry'),
    formatTarget: (b) => `${b.toFixed(0)} yds`,
    evaluate: (shots, a) => beatRecord(shots, a, 'carry', 'yds'),
  },
  {
    scope: 'range',
    id: 'ball-speed-pr',
    title: 'Speed Session',
    description: 'Beat your fastest {club} ball speed ({target}). Needs a launch monitor or the Shot Lab.',
    emoji: '⚡',
    difficulty: 'medium',
    points: 40,
    baseline: (prior) => bestOf(prior, 'ballSpeed'),
    formatTarget: (b) => `${b.toFixed(0)} mph`,
    evaluate: (shots, a) => beatRecord(shots, a, 'ballSpeed', 'mph'),
  },
  {
    scope: 'range',
    id: 'stock-sniper',
    title: 'Stock Sniper',
    description: 'Hit 3 {club} shots that carry within 5 yards of your stock yardage ({target}).',
    emoji: '🎯',
    difficulty: 'medium',
    points: 35,
    cannotStart: (prior) =>
      good(prior).filter((s) => s.carryYards !== undefined).length < 3
        ? 'Log at least 3 shots with this club first so it has a stock yardage.'
        : undefined,
    baseline: (prior) => clubStats(prior).stockCarry,
    formatTarget: (b) => `${b.toFixed(0)} yds`,
    evaluate: (shots, a) => {
      const stock = a.baseline;
      if (stock === undefined) return { status: 'failed', progress: 0, detail: 'No stock yardage to aim at' };
      const hits = good(shots).filter((s) => s.carryYards !== undefined && Math.abs(s.carryYards - stock) <= 5).length;
      return hits >= 3
        ? { status: 'completed', progress: 1, detail: `${hits} on the number` }
        : { status: 'in_progress', progress: hits / 3, detail: `${hits}/3 within 5 yds of ${stock.toFixed(0)}` };
    },
  },
  {
    scope: 'range',
    id: 'tight-group',
    title: 'Tight Group',
    description: 'Hit 5 {club} shots in a row that all carry within a 10-yard window. A mishit resets the count.',
    emoji: '🧲',
    difficulty: 'hard',
    points: 45,
    evaluate: (shots) => {
      let best = 0;
      for (let i = 0; i < shots.length; i++) {
        let lo = Infinity;
        let hi = -Infinity;
        let run = 0;
        for (let j = i; j < shots.length; j++) {
          const c = shots[j].carryYards;
          if (shots[j].mishit || c === undefined) break;
          lo = Math.min(lo, c);
          hi = Math.max(hi, c);
          if (hi - lo > 10) break;
          run += 1;
        }
        best = Math.max(best, run);
      }
      return best >= 5
        ? { status: 'completed', progress: 1, detail: `${best} in a row inside 10 yds` }
        : { status: 'in_progress', progress: best / 5, detail: `Best run: ${best}/5` };
    },
  },
  {
    scope: 'range',
    id: 'pure-strike',
    title: 'Pure Strike',
    description: 'Hit a {club} shot with a smash factor of {target} or better (needs ball and club speed).',
    emoji: '💎',
    difficulty: 'hard',
    points: 45,
    baseline: (_prior, club) => typicalSmashForLoft(club.loft ?? 31),
    formatTarget: (b) => b.toFixed(2),
    evaluate: (shots, a) => {
      const target = a.baseline ?? 1.4;
      const smashes = good(shots)
        .map((s) => shotMetric(s, 'smash'))
        .filter((v): v is number => v !== undefined);
      const best = smashes.length ? Math.max(...smashes) : undefined;
      if (best !== undefined && best >= target) {
        return { status: 'completed', progress: 1, detail: `Smash ${best.toFixed(2)}` };
      }
      return {
        status: 'in_progress',
        progress: best === undefined ? 0 : clamp01(best / target),
        detail: best === undefined ? `Target ${target.toFixed(2)}` : `Best ${best.toFixed(2)} · target ${target.toFixed(2)}`,
      };
    },
  },
  {
    scope: 'range',
    id: 'dial-in',
    title: 'Dial It In',
    description: 'Log 10 good {club} shots in one session to sharpen your stock yardage.',
    emoji: '📏',
    difficulty: 'easy',
    points: 15,
    evaluate: (shots) => {
      const n = good(shots).filter((s) => s.carryYards !== undefined).length;
      return n >= 10
        ? { status: 'completed', progress: 1, detail: `${n} shots logged` }
        : { status: 'in_progress', progress: n / 10, detail: `${n}/10 shots` };
    },
  },
];

export const CHALLENGES: Challenge[] = [...ROUND_CHALLENGES, ...RANGE_CHALLENGES];

export const challengeById = (id: string): Challenge | undefined => CHALLENGES.find((c) => c.id === id);
export const roundChallengeById = (id: string) => ROUND_CHALLENGES.find((c) => c.id === id);
export const rangeChallengeById = (id: string) => RANGE_CHALLENGES.find((c) => c.id === id);

/** Fill in `{club}` / `{target}` placeholders. */
export function challengeText(
  text: string,
  opts: { clubName?: string; target?: string } = {},
): string {
  return text
    .replace(/\{club\}/g, opts.clubName ?? 'chosen club')
    .replace(/ ?\(\{target\}\)/g, opts.target ? ` (${opts.target})` : '')
    .replace(/\{target\}/g, opts.target ?? 'the target');
}

/** Shots that count towards a range attempt, oldest first. */
export function sessionShots(attempt: ChallengeAttempt, shots: Shot[]): Shot[] {
  return shots
    .filter(
      (s) =>
        s.clubId === attempt.clubId &&
        s.createdAt >= attempt.startedAt &&
        (!attempt.endedAt || s.createdAt <= attempt.endedAt),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The club's shots from before the attempt started (what the baseline is computed from). */
export function priorShots(clubId: string, startedAt: string, shots: Shot[]): Shot[] {
  return shots.filter((s) => s.clubId === clubId && s.createdAt < startedAt);
}

export function evaluateAttempt(attempt: ChallengeAttempt, shots: Shot[]): ChallengeProgress | undefined {
  return rangeChallengeById(attempt.challengeId)?.evaluate(sessionShots(attempt, shots), attempt);
}

/** Pick `count` distinct round challenges using a seeded shuffle, so a daily set is stable all day. */
export function dailyChallenges(date: Date, count = 3): RoundChallenge[] {
  let seed = date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();
  const rand = () => {
    // Mulberry32
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Club-specific challenges need a choice, so they aren't auto-picked.
  const pool = ROUND_CHALLENGES.filter((c) => !c.needsClub);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Ids of every challenge completed at least once, with how many completions in total. */
export function completedChallenges(
  rounds: Round[],
  attempts: ChallengeAttempt[] = [],
  shots: Shot[] = [],
): { ids: Set<string>; count: number } {
  const ids = new Set<string>();
  let count = 0;
  for (const r of rounds) {
    const pastRounds = rounds.filter((p) => p.startedAt < r.startedAt);
    for (const id of r.challengeIds) {
      if (roundChallengeById(id)?.evaluate(r, { pastRounds }).status === 'completed') {
        ids.add(id);
        count++;
      }
    }
  }
  for (const a of attempts) {
    if (evaluateAttempt(a, shots)?.status === 'completed') {
      ids.add(a.challengeId);
      count++;
    }
  }
  return { ids, count };
}

/** Levels go up every 100 challenge points. */
export const levelForPoints = (points: number) => Math.floor(points / 100) + 1;

/** Total points from completed round challenges and range sessions. */
export function totalPoints(rounds: Round[], attempts: ChallengeAttempt[] = [], shots: Shot[] = []): number {
  let pts = 0;
  for (const r of rounds) {
    // Only rounds played before this one count as "history" for this round.
    const pastRounds = rounds.filter((p) => p.startedAt < r.startedAt);
    for (const id of r.challengeIds) {
      const c = roundChallengeById(id);
      if (c && c.evaluate(r, { pastRounds }).status === 'completed') pts += c.points;
    }
  }
  for (const a of attempts) {
    const c = rangeChallengeById(a.challengeId);
    if (c && evaluateAttempt(a, shots)?.status === 'completed') pts += c.points;
  }
  return pts;
}
