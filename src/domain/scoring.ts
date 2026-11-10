import type { Course, HoleScore, Round } from './types';

export const isPlayed = (h: HoleScore): h is HoleScore & { strokes: number } =>
  typeof h.strokes === 'number' && h.strokes > 0;

/** Strokes relative to par: -1 birdie, 0 par, +1 bogey... */
export const toPar = (h: HoleScore & { strokes: number }) => h.strokes - h.par;

/** Green in regulation: on the green with two putts' worth of strokes to spare. */
export function greenInRegulation(h: HoleScore): boolean | undefined {
  if (!isPlayed(h) || typeof h.putts !== 'number') return undefined;
  return h.strokes - h.putts <= h.par - 2;
}

/** Missed the green in regulation but still made par or better. */
export function upAndDown(h: HoleScore): boolean {
  return isPlayed(h) && greenInRegulation(h) === false && toPar(h) <= 0;
}

/** Longest run of consecutive played holes satisfying `pred`. */
export function longestStreak(
  scores: HoleScore[],
  pred: (h: HoleScore & { strokes: number }) => boolean,
): number {
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

export function scoreName(diff: number): string {
  if (diff <= -3) return 'Albatross';
  if (diff === -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  if (diff === 2) return 'Double';
  return `+${diff}`;
}

export function formatToPar(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

export interface RoundSummary {
  holesPlayed: number;
  totalHoles: number;
  strokes: number;
  par: number;
  toPar: number;
  putts: number;
  fairwaysHit: number;
  fairwayChances: number;
  greensInRegulation: number;
  penalties: number;
  finished: boolean;
}

export function summarizeRound(round: Pick<Round, 'scores'>): RoundSummary {
  const played = round.scores.filter(isPlayed);
  const fairwayHoles = played.filter((h) => h.par >= 4 && h.fairwayHit !== undefined);
  return {
    holesPlayed: played.length,
    totalHoles: round.scores.length,
    strokes: played.reduce((s, h) => s + h.strokes, 0),
    par: played.reduce((s, h) => s + h.par, 0),
    toPar: played.reduce((s, h) => s + toPar(h), 0),
    putts: played.reduce((s, h) => s + (h.putts ?? 0), 0),
    fairwaysHit: fairwayHoles.filter((h) => h.fairwayHit).length,
    fairwayChances: fairwayHoles.length,
    greensInRegulation: played.filter((h) => greenInRegulation(h) === true).length,
    penalties: played.reduce((s, h) => s + (h.penalties ?? 0), 0),
    finished: round.scores.length > 0 && played.length === round.scores.length,
  };
}

/** A blank scorecard for a course; holes without a mapped par default to par 4. */
export function blankScorecard(course: Pick<Course, 'holes'> | undefined, holeCount = 18): HoleScore[] {
  if (course && course.holes.length > 0) {
    return course.holes.map((h) => ({ hole: h.number, par: h.par ?? 4 }));
  }
  return Array.from({ length: holeCount }, (_, i) => ({ hole: i + 1, par: 4 }));
}
