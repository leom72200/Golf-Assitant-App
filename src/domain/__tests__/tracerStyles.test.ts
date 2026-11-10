import { hasBrokenRecord } from '../records';
import { TRACER_STYLES, tracerById, unlockContext, unlockedTracerIds } from '../tracerStyles';
import type { ChallengeAttempt, Round, Shot } from '../types';

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5];
const round = (id: string, day: number, strokes: number[], challengeIds: string[]): Round => ({
  id,
  courseName: 'Test',
  startedAt: `2026-05-${String(day).padStart(2, '0')}T10:00:00Z`,
  finishedAt: `2026-05-${String(day).padStart(2, '0')}T14:00:00Z`,
  challengeIds,
  scores: PARS.map((par, i) => ({ hole: i + 1, par, strokes: strokes[i], putts: 2 })),
});
const shot = (id: string, at: string, carry: number, clubId = '7i'): Shot => ({
  id,
  clubId,
  createdAt: at,
  source: 'manual',
  carryYards: carry,
});

describe('tracer unlocks', () => {
  it('starts with only the classic tracer', () => {
    expect(unlockedTracerIds(unlockContext([], [], []))).toEqual(['classic']);
  });

  it('unlocks Ice Blue and Birdie Gold from a birdie-hunter round', () => {
    const r = round('r1', 1, [3, 4, 3, 5, 4, 4, 3, 4, 5], ['birdie-hunter']);
    const ids = unlockedTracerIds(unlockContext([r], [], []));
    expect(ids).toEqual(expect.arrayContaining(['classic', 'ice', 'birdie-gold']));
    expect(ids).not.toContain('flame');
  });

  it('unlocks Comet from a completed Long Ball session', () => {
    const history = [shot('a', '2026-01-01T10:00:00Z', 150)];
    const attempt: ChallengeAttempt = {
      id: 'x',
      challengeId: 'distance-pr',
      clubId: '7i',
      startedAt: '2026-02-01T10:00:00Z',
      baseline: 150,
    };
    const shots = [...history, shot('b', '2026-02-01T10:05:00Z', 155)];
    const ids = unlockedTracerIds(unlockContext([], [attempt], shots));
    expect(ids).toEqual(expect.arrayContaining(['comet', 'record', 'ice']));
  });

  it('every style has a unique id and the default resolves', () => {
    expect(new Set(TRACER_STYLES.map((s) => s.id)).size).toBe(TRACER_STYLES.length);
    expect(tracerById('nope').id).toBe('classic');
  });
});

describe('hasBrokenRecord', () => {
  it('needs a later shot to beat an earlier one with the same club', () => {
    expect(hasBrokenRecord([shot('a', '2026-01-01', 150)])).toBe(false);
    expect(hasBrokenRecord([shot('a', '2026-01-01', 150), shot('b', '2026-01-02', 140)])).toBe(false);
    expect(hasBrokenRecord([shot('a', '2026-01-01', 150), shot('b', '2026-01-02', 160, '6i')])).toBe(false);
    expect(hasBrokenRecord([shot('b', '2026-01-02', 160), shot('a', '2026-01-01', 150)])).toBe(true);
  });
});
