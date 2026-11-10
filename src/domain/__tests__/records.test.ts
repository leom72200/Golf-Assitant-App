import { clubRecords, newRecordsForShot, roundRecords } from '../records';
import type { HoleScore, Round, Shot } from '../types';

const shot = (id: string, extra: Partial<Shot>): Shot => ({
  id,
  clubId: 'dr',
  createdAt: `2026-01-0${id.slice(-1)}T10:00:00Z`,
  source: 'manual',
  ...extra,
});

describe('clubRecords', () => {
  it('finds the best of each metric, ignoring mishits', () => {
    const r = clubRecords([
      shot('s1', { carryYards: 230, totalYards: 250, ballSpeedMph: 140, clubSpeedMph: 95 }),
      shot('s2', { carryYards: 245, ballSpeedMph: 150, clubSpeedMph: 102 }),
      shot('s3', { carryYards: 300, mishit: true }),
    ]);
    expect(r.carry).toMatchObject({ value: 245, shotId: 's2' });
    expect(r.total?.value).toBe(250);
    expect(r.ballSpeed?.value).toBe(150);
    expect(r.clubSpeed?.value).toBe(102);
    expect(r.smash?.value).toBeCloseTo(1.474, 3);
  });

  it('ignores impossible smash factors', () => {
    const r = clubRecords([shot('s1', { ballSpeedMph: 150, clubSpeedMph: 50 })]);
    expect(r.smash).toBeUndefined();
  });

  it('keeps the earlier shot on a tie', () => {
    const r = clubRecords([shot('s1', { carryYards: 200 }), shot('s2', { carryYards: 200 })]);
    expect(r.carry?.shotId).toBe('s1');
  });
});

describe('newRecordsForShot', () => {
  const history = [shot('s1', { carryYards: 230, ballSpeedMph: 140 })];

  it('reports each record the shot breaks', () => {
    const broken = newRecordsForShot(history, shot('s2', { carryYards: 240, ballSpeedMph: 138 }));
    expect(broken.map((b) => b.metric)).toEqual(['carry']);
    expect(broken[0]).toMatchObject({ value: 240, previous: 230 });
  });

  it("doesn't celebrate a first shot, a mishit, or another club", () => {
    expect(newRecordsForShot([], shot('s2', { carryYards: 240 }))).toEqual([]);
    expect(newRecordsForShot(history, shot('s2', { carryYards: 240, mishit: true }))).toEqual([]);
    expect(newRecordsForShot(history, shot('s2', { carryYards: 240, clubId: '3w' }))).toEqual([]);
  });
});

describe('roundRecords', () => {
  const PARS = [4, 3, 5, 4, 4, 3, 4, 5, 4];
  const round = (id: string, day: number, strokes: number[], extra: Partial<HoleScore> = {}, holes = 9): Round => ({
    id,
    courseId: 'c1',
    courseName: 'Test Links',
    startedAt: `2026-03-${String(day).padStart(2, '0')}T10:00:00Z`,
    finishedAt: `2026-03-${String(day).padStart(2, '0')}T14:00:00Z`,
    challengeIds: [],
    scores: Array.from({ length: holes }, (_, i) => ({
      hole: i + 1,
      par: PARS[i % 9],
      strokes: strokes[i],
      putts: 2,
      ...extra,
    })),
  });

  it('tracks best scores, birdies and streaks', () => {
    const r1 = round('r1', 1, PARS.map((p) => p + 1)); // +9
    const r2 = round('r2', 2, [3, 3, 5, 4, 4, 4, 4, 5, 3]); // 2 birdies, -1 overall
    const rec = roundRecords([r1, r2]);
    expect(rec.best9).toMatchObject({ value: -1, roundId: 'r2' });
    expect(rec.mostBirdies?.value).toBe(2);
    expect(rec.longestParStreak?.value).toBe(5);
    expect(rec.courseBests).toEqual([expect.objectContaining({ courseName: 'Test Links', value: -1 })]);
    expect(rec.best18).toBeUndefined();
  });

  it('only counts finished, complete cards for score records', () => {
    const partial = { ...round('r3', 3, [3, 3]), finishedAt: '2026-03-03T12:00:00Z' };
    const unfinished = { ...round('r4', 4, PARS), finishedAt: undefined };
    const rec = roundRecords([partial, unfinished]);
    expect(rec.best9).toBeUndefined();
    expect(rec.mostBirdies?.value).toBe(1); // the partial round's birdie still counts
  });

  it('records fewest putts over 18 holes', () => {
    const r = round('r5', 5, [...PARS, ...PARS], { putts: 1 }, 18);
    expect(roundRecords([r]).fewestPutts18?.value).toBe(18);
  });
});
