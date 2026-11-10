/**
 * Personal records ("PRs"), derived from logged shots and rounds. Nothing is stored separately,
 * so records always reflect the current data (deleting a shot can lower a record).
 */
import { greenInRegulation, isPlayed, longestStreak, summarizeRound, toPar } from './scoring';
import type { Round, Shot } from './types';

export interface RecordEntry {
  value: number;
  /** ISO date the record was set. */
  date: string;
  shotId?: string;
  roundId?: string;
  /** Extra context, e.g. the course name. */
  label?: string;
}

export type ShotMetric = 'carry' | 'total' | 'ballSpeed' | 'clubSpeed' | 'smash';

export const SHOT_METRICS: { key: ShotMetric; label: string; unit: string; digits: number }[] = [
  { key: 'carry', label: 'Longest carry', unit: 'yds', digits: 0 },
  { key: 'total', label: 'Longest total', unit: 'yds', digits: 0 },
  { key: 'ballSpeed', label: 'Fastest ball speed', unit: 'mph', digits: 0 },
  { key: 'clubSpeed', label: 'Fastest club speed', unit: 'mph', digits: 0 },
  { key: 'smash', label: 'Best smash factor', unit: '', digits: 2 },
];

/** Smash factors above this are almost certainly typos (the legal limit is ~1.50). */
const MAX_PLAUSIBLE_SMASH = 1.56;

export function shotMetric(shot: Shot, metric: ShotMetric): number | undefined {
  switch (metric) {
    case 'carry':
      return shot.carryYards;
    case 'total':
      return shot.totalYards;
    case 'ballSpeed':
      return shot.ballSpeedMph;
    case 'clubSpeed':
      return shot.clubSpeedMph;
    case 'smash': {
      if (!shot.ballSpeedMph || !shot.clubSpeedMph) return undefined;
      const s = shot.ballSpeedMph / shot.clubSpeedMph;
      return s <= MAX_PLAUSIBLE_SMASH ? s : undefined;
    }
  }
}

export type ClubRecords = Partial<Record<ShotMetric, RecordEntry>>;

/** Best value of each metric for one club's shots. Mishits never count as records. */
export function clubRecords(shots: Shot[]): ClubRecords {
  const out: ClubRecords = {};
  for (const shot of shots) {
    if (shot.mishit) continue;
    for (const { key } of SHOT_METRICS) {
      const v = shotMetric(shot, key);
      if (v === undefined || !Number.isFinite(v)) continue;
      const cur = out[key];
      // Ties go to whoever did it first.
      if (!cur || v > cur.value) out[key] = { value: v, date: shot.createdAt, shotId: shot.id };
    }
  }
  return out;
}

export interface NewRecord {
  metric: ShotMetric;
  label: string;
  unit: string;
  digits: number;
  value: number;
  previous?: number;
}

/**
 * Which records a new shot breaks, compared with the club's earlier shots.
 * The first shot with a club doesn't count as a "record" (there was nothing to beat).
 */
export function newRecordsForShot(previousShots: Shot[], shot: Shot): NewRecord[] {
  if (shot.mishit) return [];
  const before = clubRecords(previousShots.filter((s) => s.clubId === shot.clubId && s.id !== shot.id));
  const broken: NewRecord[] = [];
  for (const m of SHOT_METRICS) {
    const v = shotMetric(shot, m.key);
    const prev = before[m.key]?.value;
    if (v !== undefined && prev !== undefined && v > prev) {
      broken.push({ metric: m.key, label: m.label, unit: m.unit, digits: m.digits, value: v, previous: prev });
    }
  }
  return broken;
}

export interface RoundRecords {
  /** Lowest score to par in a finished 18-hole round. */
  best18?: RecordEntry;
  best9?: RecordEntry;
  fewestPutts18?: RecordEntry;
  mostBirdies?: RecordEntry;
  longestParStreak?: RecordEntry;
  mostFairways?: RecordEntry;
  mostGreens?: RecordEntry;
  /** Best score to par for each course (finished rounds of the course's full length). */
  courseBests: (RecordEntry & { courseName: string })[];
}

/** Keep the better entry; `lower` means smaller is better. Earlier date wins ties. */
function better(cur: RecordEntry | undefined, next: RecordEntry, lower = false): RecordEntry {
  if (!cur) return next;
  if (lower ? next.value < cur.value : next.value > cur.value) return next;
  return cur;
}

export function roundRecords(rounds: Round[]): RoundRecords {
  const out: RoundRecords = { courseBests: [] };
  const byCourse = new Map<string, RecordEntry & { courseName: string }>();
  const ordered = rounds.filter((r) => r.finishedAt).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  for (const r of ordered) {
    const s = summarizeRound(r);
    if (s.holesPlayed === 0) continue;
    const entry = (value: number): RecordEntry => ({ value, date: r.startedAt, roundId: r.id, label: r.courseName });
    const played = r.scores.filter(isPlayed);

    // "Per round" counts only make sense from a full card.
    if (s.finished) {
      if (s.totalHoles === 18) {
        out.best18 = better(out.best18, entry(s.toPar), true);
        if (played.every((h) => typeof h.putts === 'number')) {
          out.fewestPutts18 = better(out.fewestPutts18, entry(s.putts), true);
        }
      }
      if (s.totalHoles === 9) out.best9 = better(out.best9, entry(s.toPar), true);
      const key = r.courseId ?? `casual-${s.totalHoles}`;
      const cur = byCourse.get(key);
      if (!cur || s.toPar < cur.value) byCourse.set(key, { ...entry(s.toPar), courseName: r.courseName });
    }

    const birdies = played.filter((h) => toPar(h) <= -1).length;
    if (birdies > 0) out.mostBirdies = better(out.mostBirdies, entry(birdies));
    const streak = longestStreak(r.scores, (h) => toPar(h) <= 0);
    if (streak > 0) out.longestParStreak = better(out.longestParStreak, entry(streak));
    if (s.fairwaysHit > 0) out.mostFairways = better(out.mostFairways, entry(s.fairwaysHit));
    const greens = played.filter((h) => greenInRegulation(h) === true).length;
    if (greens > 0) out.mostGreens = better(out.mostGreens, entry(greens));
  }

  out.courseBests = [...byCourse.values()].sort((a, b) => a.courseName.localeCompare(b.courseName));
  return out;
}
