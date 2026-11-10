import {
  CHALLENGES,
  challengeText,
  dailyChallenges,
  evaluateAttempt,
  rangeChallengeById,
  roundChallengeById,
  totalPoints,
} from '../challenges';
import { DEFAULT_BAG } from '../clubs';
import { summarizeRound } from '../scoring';
import type { ChallengeAttempt, HoleScore, Round, Shot } from '../types';

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
  roundChallengeById(id)!.evaluate(r, { pastRounds });

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

  it('One-Club Wonder needs a par on a hole flagged as single-club', () => {
    const plain = round([{ strokes: 4 }]);
    expect(evaluate('one-club-par', plain).status).toBe('in_progress');
    const oneClub = round([{ strokes: 5 }, { strokes: 4, singleClub: true }]);
    expect(evaluate('one-club-par', oneClub).status).toBe('completed');
    expect(evaluate('one-club-birdie', oneClub).status).toBe('in_progress');
    expect(evaluate('one-club-birdie', round([{ strokes: 3, singleClub: true }])).status).toBe('completed');
  });

  it('fills in club names and targets', () => {
    const c = rangeChallengeById('distance-pr')!;
    expect(challengeText(c.description, { clubName: '7i', target: '172 yds' })).toBe(
      'Out-carry your longest 7i shot (172 yds).',
    );
    expect(challengeText(c.description, { clubName: '7i' })).toBe('Out-carry your longest 7i shot.');
  });

  it('daily challenges are stable for a date and distinct', () => {
    const a = dailyChallenges(new Date(2026, 10, 10)).map((c) => c.id);
    const b = dailyChallenges(new Date(2026, 10, 10)).map((c) => c.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    // Club-specific challenges need a choice, so they're never auto-picked.
    for (const id of a) expect(roundChallengeById(id)?.needsClub).toBeFalsy();
  });

  it('totals points for completed challenges only', () => {
    const r = { ...round(PARS.map((par) => ({ strokes: par, putts: 2 }))), challengeIds: ['no-three-putts', 'birdie-hunter'] };
    expect(totalPoints([r])).toBe(roundChallengeById('no-three-putts')!.points);
  });
});

describe('range challenges', () => {
  const sevenIron = DEFAULT_BAG.find((c) => c.id === '7i')!;
  let n = 0;
  const shot = (carry: number, at: string, extra: Partial<Shot> = {}): Shot => ({
    id: `s${n++}`,
    clubId: '7i',
    createdAt: at,
    source: 'manual',
    carryYards: carry,
    ...extra,
  });
  const history = [shot(150, '2026-01-01T10:00:00Z'), shot(160, '2026-01-02T10:00:00Z'), shot(155, '2026-01-03T10:00:00Z')];
  const startedAt = '2026-02-01T10:00:00Z';
  const attempt = (id: string, extra: Partial<ChallengeAttempt> = {}): ChallengeAttempt => {
    const c = rangeChallengeById(id)!;
    return { id: 'a', challengeId: id, clubId: '7i', startedAt, baseline: c.baseline?.(history, sevenIron), ...extra };
  };

  it('Long Ball uses the record at the start of the session as the target', () => {
    const a = attempt('distance-pr');
    expect(a.baseline).toBe(160);
    expect(evaluateAttempt(a, [...history, shot(158, '2026-02-01T10:05:00Z')])?.status).toBe('in_progress');
    const done = evaluateAttempt(a, [...history, shot(163, '2026-02-01T10:06:00Z')]);
    expect(done?.status).toBe('completed');
    expect(done?.detail).toContain('163');
  });

  it('ignores mishits, other clubs and shots outside the session', () => {
    const a = attempt('distance-pr', { endedAt: '2026-02-01T11:00:00Z' });
    const shots = [
      ...history,
      shot(170, '2026-02-01T10:05:00Z', { mishit: true }),
      shot(170, '2026-02-01T10:06:00Z', { clubId: '6i' }),
      shot(170, '2026-02-01T12:00:00Z'), // after the session ended
    ];
    expect(evaluateAttempt(a, shots)?.status).toBe('in_progress');
  });

  it('Stock Sniper needs history and counts shots near the stock carry', () => {
    const c = rangeChallengeById('stock-sniper')!;
    expect(c.cannotStart?.(history.slice(0, 2), sevenIron)).toBeDefined();
    expect(c.cannotStart?.(history, sevenIron)).toBeUndefined();
    const a = attempt('stock-sniper');
    expect(a.baseline).toBe(155);
    const shots = ['10:01', '10:02', '10:03'].map((t, i) => shot([152, 158, 160][i], `2026-02-01T${t}:00Z`));
    expect(evaluateAttempt(a, shots)?.status).toBe('completed');
  });

  it('Tight Group needs 5 in a row inside 10 yards', () => {
    const a = attempt('tight-group');
    const carries = [150, 152, 148, 155, 151];
    const run = carries.map((c, i) => shot(c, `2026-02-01T10:0${i}:00Z`));
    expect(evaluateAttempt(a, run)?.status).toBe('completed');
    const broken = [...run.slice(0, 2), shot(100, '2026-02-01T10:02:30Z', { mishit: true }), ...run.slice(2)];
    expect(evaluateAttempt(a, broken)?.status).toBe('in_progress');
  });

  it('awards points for completed sessions', () => {
    const a = attempt('dial-in');
    const shots = Array.from({ length: 10 }, (_, i) => shot(150, `2026-02-01T10:${String(10 + i)}:00Z`));
    expect(totalPoints([], [a], shots)).toBe(rangeChallengeById('dial-in')!.points);
  });

  it('every challenge id is unique across both kinds', () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
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
