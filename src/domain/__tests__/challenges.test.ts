import { challengeById, CHALLENGES, dailyChallenges, totalPoints } from '../challenges';
import { summarizeRound } from '../scoring';
import type { HoleScore, Round } from '../types';

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5];

function round(entries: Partial<HoleScore>[], id = 'r1', startedAt = '2026-06-01T10:00:00Z'): Round {
  return {
    id,
    courseName: 'Test',
    startedAt,
    challengeIds: [],
    scores: PARS.map((par, i) => ({ hole: i + 1, par, ...(entries[i] ?? {}) })),
  };
}

const evaluate = (id: string, r: Round, pastRounds: Round[] = []) =>
  challengeById(id)!.evaluate(r, { pastRounds });

describe('challenges', () => {
  it('has unique ids', () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
  });

  it('Lag Master fails on the first 3-putt and completes on a clean card', () => {
    const clean = round(PARS.map((par) => ({ strokes: par, putts: 2 })));
    expect(evaluate('no-three-putts', clean).status).toBe('completed');

    const bad = round([{ strokes: 4, putts: 2 }, { strokes: 6, putts: 3 }]);
    const res = evaluate('no-three-putts', bad);
    expect(res.status).toBe('failed');
    expect(res.detail).toContain('hole 2');
  });

  it('Hot Streak needs three pars in a row', () => {
    const r = round([{ strokes: 4 }, { strokes: 5 }, { strokes: 3 }, { strokes: 5 }, { strokes: 4 }]);
    expect(evaluate('par-streak', r).status).toBe('completed');
    const broken = round([{ strokes: 4 }, { strokes: 4 }, { strokes: 4 }]);
    expect(evaluate('par-streak', broken).status).toBe('in_progress');
  });

  it('Fairway Finder fails early once the target is out of reach', () => {
    // 7 non-par-3 holes on this 9-hole card, so the target is 7 of 7: one miss fails it.
    const r = round([{ strokes: 5, fairwayHit: false }]);
    expect(evaluate('fairway-finder', r).status).toBe('failed');
  });

  it('Scrambler counts up-and-downs', () => {
    // Par 4 in 4 with 1 putt: 3 strokes to reach the green = missed GIR, saved par.
    const save = { strokes: 4, putts: 1 };
    const r = round([save, save, {}, {}, save]);
    expect(evaluate('scrambler', r).status).toBe('completed');
  });

  it('Personal Best Pace compares against past finished rounds', () => {
    const past = round(PARS.map((par) => ({ strokes: par + 1 })), 'old'); // +9
    const better = round(PARS.map((par) => ({ strokes: par })), 'new'); // E
    expect(evaluate('beat-average', better, [past]).status).toBe('completed');
    expect(evaluate('beat-average', past, [better]).status).toBe('failed');
    expect(evaluate('beat-average', better, []).status).toBe('in_progress');
  });

  it('daily challenges are stable for a date and distinct', () => {
    const a = dailyChallenges(new Date(2026, 10, 10)).map((c) => c.id);
    const b = dailyChallenges(new Date(2026, 10, 10)).map((c) => c.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
  });

  it('totals points for completed challenges only', () => {
    const r = { ...round(PARS.map((par) => ({ strokes: par, putts: 2 }))), challengeIds: ['no-three-putts', 'birdie-hunter'] };
    expect(totalPoints([r])).toBe(challengeById('no-three-putts')!.points);
  });
});

describe('summarizeRound', () => {
  it('totals the card', () => {
    const s = summarizeRound(round([{ strokes: 5, putts: 2, fairwayHit: true }, { strokes: 4, putts: 1 }]));
    expect(s.holesPlayed).toBe(2);
    expect(s.toPar).toBe(1);
    expect(s.putts).toBe(3);
    expect(s.fairwaysHit).toBe(1);
    expect(s.finished).toBe(false);
  });
});
